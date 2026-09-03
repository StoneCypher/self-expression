/**
 * The `gallery` card type — the catalogue's own front door.
 *
 * There are 56 card types today and there will be hundreds inside a year, and the people reading
 * this list are not all programmers: Claude Code is used by doctors, architects and plumbers. So
 * this card has two jobs that pull against each other, and nearly every decision in it is a
 * compromise between them.
 *
 *   1. **Onboarding.** A newcomer does not know what exists and cannot be handed 56 names. The
 *      entry point is therefore the category *question* — "What does the spread look like?",
 *      "Where?" — because a question needs no vocabulary. Every row leads with what a card is
 *      FOR; the data shape is one fold further down, where it cannot ambush anyone.
 *   2. **An index.** Someone who already knows the catalogue wants one type, fast, out of
 *      hundreds. That wants everything visible at once, which is exactly what job 1 forbids.
 *
 * The settlement: folded by default (job 1), with a filter that searches as you type and opens
 * only the categories that match (job 2), and a `shapes` setting that lifts the technical line
 * into the row for the reader who wants to compare shapes at a glance. Nobody has to argue about
 * which audience wins, because the fold and the filter let each one have the card they wanted.
 *
 * ## Fetched, not baked
 *
 * The live content comes from `GET /cardtypes`, which reads `types/` from disk on every request.
 * That is deliberate and it is the whole reason this type exists rather than a generated table:
 * a contributor drops a file into `types/` and it appears on the next look, with no build step
 * and nobody remembering to run one. An index that must be regenerated is an index that will be
 * wrong, and the failure is silent — the catalogue simply stops mentioning the newest types and
 * nothing anywhere reports it.
 *
 * A complete static rendering is still emitted at build time, from `catalogue()`, so the card is
 * useful before its script runs and if the endpoint is down. When the fetch succeeds the script
 * replaces it; when the fetch fails the static copy stays and the caption says out loud that it
 * is a snapshot and when it was taken. A stale list that claims to be live is worse than no list.
 *
 * `build` is synchronous by contract and `catalogue()` is not, so the snapshot is passed in as
 * `data` — {@link snapshot} produces it in exactly the shape the endpoint returns, so there is
 * one shape to think about and the same normaliser reads both.
 *
 * @see snapshot for the build-time read
 * @see RENDER_SRC for the renderer, which is the same text in Node and in the browser
 */

import { CATEGORIES, CATEGORY_KEYS, categoryLabel, groupByCategory } from '../categories.mjs';

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Three, and each one exists to settle the two-audiences tension rather than to add a knob:
 *
 *   - `live` — re-read the catalogue from `/cardtypes`. Turning it off pins the build-time
 *     snapshot, which is what you want on a machine with no server, or when you deliberately
 *     want to see what the card was built knowing.
 *   - `openAll` — start with every category unfolded. Folded is right for a newcomer and wrong
 *     for someone who has read the list forty times; this is the switch between them.
 *   - `shapes` — lift each type's data shape into its row instead of one fold down. Off for the
 *     reader who does not yet know what a shape is; on for the reader comparing five of them.
 *
 * Declared above {@link meta} so `meta.defaults` can be spread from it: the contract wants the
 * settings reachable from `meta`, this file wants them as a named export the emitter can reach,
 * and spreading one from the other keeps one written source.
 *
 * @example defaults.openAll;   // false
 */
export const defaults = { live: true, openAll: false, shapes: false };

/**
 * What this type is and what it eats, for the catalogue's listing — including its own.
 *
 * The category is `work-and-lists` because the question that category asks — "What is
 * outstanding, and what can I do about it?" — is very nearly what someone arriving at a
 * catalogue is asking, and every row here ends in a command you can run.
 *
 * @example meta.name;       // 'gallery'
 * @example meta.category;   // 'work-and-lists'
 */
export const meta = {
  name: 'gallery',
  summary: 'The card catalogue itself, folded by the question each category answers and searchable by what a type is for.',
  shape: '{ types: [{ name, summary, shape, category, settings }], unreadable, at } — ' +
         'the shape GET /cardtypes returns; a Map from catalogue() or bare [name, module] pairs ' +
         'are accepted too, and absent data renders an honest empty card that fetches on load',
  category: 'work-and-lists',
  defaults: { ...defaults },
};

/**
 * The backtick, built from its code point rather than typed.
 *
 * Every place this module needs the character as a *value* goes through here, so no code path can
 * produce one by accident. Backticks still appear in this file's doc comments, marking code spans
 * the way prose does, and that is safe in ordinary comments — but it is exactly what is NOT safe
 * inside the CSS template literal at the bottom of the file, where one closes the literal early
 * and turns the rest of the stylesheet into JavaScript. That happened while this card was being
 * written, on the first build, in a comment explaining a setting.
 *
 * The emitted script is the case that really matters, and it is checked rather than trusted: any
 * function sent to the browser through `Function.prototype.toString()` carries its comments with
 * it, every card's script is concatenated into ONE inline block, and one parse error blanks the
 * whole desk rather than only this card. {@link assertClassic} refuses a script containing one.
 *
 * @example TICK.charCodeAt(0);   // 96
 */
const TICK = String.fromCharCode(96);

/**
 * A JSON literal for any value, safe to paste into the emitted classic script.
 *
 * `JSON.stringify` alone is not enough for text that lands in a `<script>`: `</` would close the
 * element, and U+2028/U+2029 are line terminators to a JavaScript parser but not to JSON. The
 * backtick and the question mark are rewritten for a different reason — the build refuses a
 * script containing a backtick, an arrow or optional chaining, and a category question ending in
 * `?` sitting next to a `.` would trip that guard with a mystifying message about a rule the data
 * did not break. Cheaper to make the data unable to spell the forbidden tokens at all.
 *
 * Every replaced character only ever occurs inside a JSON string, so rewriting it as an escape
 * changes the literal's spelling and not its value.
 *
 * @param v anything JSON can carry
 *
 * @example embed({ q: 'Where?' });   // '{"q":"Where\\u003f"}'
 */
function embed(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .split(TICK).join('\\u0060')
    .replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A JavaScript string literal for a value, safe to paste into the emitted classic script.
 *
 * @param s the text to embed
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return embed(String(s == null ? '' : s));
}

/**
 * A copy of some JavaScript with every comment body and string body replaced by spaces.
 *
 * Length is preserved character for character, so an offset found in the blanked copy is the same
 * offset in the original and a complaint can still point at a real line.
 *
 * This exists because a keyword scan that reads prose cries wolf, and a guard that cries wolf is
 * a guard that gets deleted. A card was refused because one of its own comments said "the class
 * is what CSS reads" — a true sentence, in a comment, about CSS, which the build called an ES6
 * class. Keyword bans are therefore checked against code only.
 *
 * The scan is a single left-to-right pass, which is what makes it right on the two cases that
 * defeat regex versions: an apostrophe inside a comment does not open a string, and a comment
 * marker inside a string does not open a comment. Regular-expression literals are not recognised
 * and do not need to be, because the emitted script deliberately contains none — `split`/`join`
 * is used everywhere a `replace` would want one — and a lone slash is neither a quote nor a
 * keyword, so leaving it as itself is safe.
 *
 * @param src any JavaScript source
 * @returns the same length of text with only code left legible
 *
 * @example blankOut('var a = "let";').indexOf('let');   // -1
 * @example blankOut('var a = 1;').length;               // 10
 */
function blankOut(src) {
  const keep = (ch) => (ch === '\n' ? '\n' : ' ');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i), n = src.charAt(i + 1);

    if (c === '/' && n === '/') {
      out += '  '; i += 2;
      while (i < src.length && src.charAt(i) !== '\n') { out += keep(src.charAt(i)); i += 1; }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) {
        out += keep(src.charAt(i)); i += 1;
      }
      if (i < src.length) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === TICK) {
      out += c; i += 1;
      while (i < src.length && src.charAt(i) !== c) {
        if (src.charAt(i) === '\\') { out += '  '; i += 2; continue; }
        out += keep(src.charAt(i)); i += 1;
      }
      if (i < src.length) { out += c; i += 1; }
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

/**
 * Refuse to emit anything that is not a classic script, loudly, at build time.
 *
 * Exported because the guard is worth more than this one card: it is run over the emitted script
 * before the card is returned, and over this module's own source by the type's verifier, which is
 * where two of the evening's parse failures actually lived — a check on the emitted code cannot
 * reach the module that emits it.
 *
 * Backtick, arrow and optional chaining are scanned RAW, comments included, because none of them
 * can appear innocently and because `Function.prototype.toString()` ships comments to the browser:
 * a backtick around a word in a doc comment closes the surrounding template literal early, and the
 * parse error blanks every card on the page, not just this one. `const`, `let` and `class` are
 * scanned only after {@link blankOut}, because English prose says all three.
 *
 * @param src  the source to judge
 * @param what a name for it, used in the message
 * @returns `src` unchanged, so the call can wrap the value it checks
 *
 * @throws {Error} naming the offence, the line, and forty characters either side of it
 *
 * @example assertClassic('var a = 1;', 'js');   // 'var a = 1;'
 * @example assertClassic('var f = () => 1;', 'js');   // throws: an arrow function at line 1
 */
export function assertClassic(src, what) {
  const code = blankOut(src);
  const found = [];

  for (const [name, token] of [
    ['a backtick (a template literal, or prose in a comment)', TICK],
    ['an arrow function', '=>'],
    ['optional chaining', '?.'],
  ]) {
    const at = src.indexOf(token);
    if (at >= 0) found.push([name, at]);
  }

  for (const [name, re] of [
    ['a const declaration', /\bconst\b/],
    ['a let declaration', /\blet\b/],
    ['a class declaration', /\bclass\b/],
  ]) {
    const at = code.search(re);
    if (at >= 0) found.push([name, at]);
  }

  /* A control character, compared numerically rather than matched against a character class,
     because writing the class is how the class gets corrupted — and an escape written correctly
     can still be decoded one step too early during emission, so the only safe move is to avoid
     the literal in every form. It is legal JavaScript inside a string, so nothing downstream
     complains: it survives a syntax check, it is invisible in an editor, and it lands on the page
     as a byte nobody can see or grep for. Tab, newline and carriage return are text and stay. */
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charCodeAt(i);
    if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0x7f) {
      found.push(['a control character, code point ' + c, i]);
      break;
    }
  }

  if (found.length === 0) return src;
  found.sort((a, b) => a[1] - b[1]);
  const at = found[0][1];
  const line = src.slice(0, at).split('\n').length;
  throw new Error('gallery: emitted ' + what + ' contains ' + found[0][0] + ' at line ' + line +
                  ': ' + JSON.stringify(src.slice(Math.max(0, at - 40), at + 40)));
}

/* ── the renderer, shipped and used ───────────────────────────────────────────────────────── */

/**
 * The whole renderer, as browser source.
 *
 * This string is emitted verbatim inside `js` **and** run in Node through `new Function` to
 * produce the static fallback, so the markup a reader sees before the script runs is made by the
 * same function that remakes it afterwards. That is the contract's own advice and it is here for
 * the contract's own reason: a Node-shaped twin of a browser renderer disagrees with it
 * eventually, and the disagreement is silent — the static list and the live list quietly stop
 * being the same page and nothing errors.
 *
 * Everything a card renders is untrusted, including the type metadata: a summary may hold
 * `</script>`, a shape may hold `<img onerror=...>`, either may hold a control character. There
 * is therefore exactly one escape in the card, `ckgEsc`, and every value passes through it on
 * both sides of the wire.
 *
 * Classic script throughout — `var`, `function`, no template literals, no arrows, no `const` —
 * and no regular-expression literals, so {@link blankOut} does not have to recognise them.
 *
 * @example
 * new Function(RENDER_SRC + ' return ckgEsc;')()('a<b');   // 'a&lt;b'
 */
const MODEL_SRC = [
  "  /* The one escape. Mirrors CK.esc byte for byte, deliberately: this card renders in Node and",
  "     in the browser, and a card whose two halves disagree about what is safe has a hole in",
  "     whichever half is more permissive. Duplicated rather than imported because kit.js is a",
  "     classic script and not a module, and because Node has no CK at all. */",
  "  function ckgEsc(s) {",
  "    var raw = s === null || s === undefined ? '' : String(s), out = '', i, c;",
  "",
  "    /* Control characters are dropped BEFORE the HTML escaping, not after, and compared",
  "       numerically rather than matched against a character class — writing the class is how the",
  "       class gets corrupted. They are invisible when written, invisible on readback, legal in an",
  "       attribute, and a card that renders one has put a byte on the page nobody can see or",
  "       delete. Tab, newline and carriage return are text and survive. */",
  "    for (i = 0; i < raw.length; i++) {",
  "      c = raw.charCodeAt(i);",
  "      if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;",
  "      if (c === 127) continue;",
  "      out += raw.charAt(i);",
  "    }",
  "",
  "    /* split/join rather than replace, so the emitted script carries no regular-expression",
  "       literal for the build-time guard to have to understand. Ampersand first, or the escapes",
  "       this pass writes would be escaped again by the next one. */",
  "    return out.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')",
  "              .split('\\\"').join('&quot;').split(\"'\").join('&#39;');",
  "  }",
  "",
  "  /** A string, or the empty string. Anything else is a defect upstream and is not printed. */",
  "  function ckgStr(v) { return typeof v === 'string' ? v : ''; }",
  "",
  "  /** Array test that survives a value from JSON.parse in any realm. */",
  "  function ckgIsArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }",
  "",
  "  /** '1 type' / '2 types', because 'showing 1 of 1 types' reads like a bug in the counter. */",
  "  function ckgPlural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }",
  "",
  "  /**",
  "   * A name reduced to something that can be a card id and a filename.",
  "   *",
  "   * The command in each row is meant to be copied and run, so the id and the data file it names",
  "   * have to be spellable. The TYPE name itself is printed as it really is, unslugged, because",
  "   * that part is a fact about the catalogue rather than a suggestion.",
  "   */",
  "  function ckgSlug(s) {",
  "    var out = '', i, ch, c;",
  "    for (i = 0; i < s.length; i++) {",
  "      ch = s.charAt(i).toLowerCase();",
  "      c = ch.charCodeAt(0);",
  "      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch;",
  "      else if (out.length > 0 && out.charAt(out.length - 1) !== '-') out += '-';",
  "    }",
  "    while (out.length > 0 && out.charAt(out.length - 1) === '-') out = out.slice(0, out.length - 1);",
  "    return out.length > 0 ? out : 'card';",
  "  }",
  "",
  "  /** What the filter searches: name, summary and shape, lowercased, in one string. */",
  "  function ckgHay(t) { return (t.name + ' ' + t.summary + ' ' + t.shape).toLowerCase(); }",
  "",
  "  /**",
  "   * Normalise whatever /cardtypes said into rows this card can render.",
  "   *",
  "   * Field by field rather than by trusting the payload: the endpoint reads files from disk that",
  "   * anyone may have dropped there, so a summary that is an object, a settings list that is a",
  "   * string, or a missing name are all things that happen and none of them should blank the card.",
  "   * The coercions match categories.mjs exactly, so the browser's grouping and the build's",
  "   * grouping cannot disagree about what a row is.",
  "   */",
  "  function ckgRows(payload) {",
  "    var src, out = [], i, j, t, sets, seen, k;",
  "    if (ckgIsArr(payload)) src = payload;",
  "    else if (payload && typeof payload === 'object' && ckgIsArr(payload.types)) src = payload.types;",
  "    else src = [];",
  "",
  "    for (i = 0; i < src.length; i++) {",
  "      t = src[i];",
  "      if (!t || typeof t !== 'object') continue;",
  "      sets = [];",
  "      seen = {};",
  "      if (ckgIsArr(t.settings)) {",
  "        for (j = 0; j < t.settings.length; j++) {",
  "          k = t.settings[j];",
  "          if (typeof k !== 'string') continue;",
  "          /* Keys are prefixed with a space so a setting called __proto__ or constructor is",
  "             stored rather than mistaken for something the bare object already had. A printable",
  "             separator, so the trick is visible to anyone reading the emitted script. */",
  "          if (Object.prototype.hasOwnProperty.call(seen, ' ' + k)) continue;",
  "          seen[' ' + k] = 1;",
  "          sets.push(k);",
  "        }",
  "      }",
  "      out.push({",
  "        name: ckgStr(t.name) || '(unnamed)',",
  "        summary: ckgStr(t.summary),",
  "        shape: ckgStr(t.shape),",
  "        category: typeof t.category === 'string' ? t.category : null,",
  "        settings: sets",
  "      });",
  "    }",
  "    return out;",
  "  }",
  "",
  "  function ckgByName(a, b) { return a.name.localeCompare(b.name); }",
  "",
  "  /* A member row carries only what a member row renders. The category is dropped on the way",
  "     into the bin because the bin IS the category, and because the fields have to match what",
  "     groupByCategory produces field for field — the type's verifier compares the two structures",
  "     directly, and a comparison that has to know about an allowed difference stops catching the",
  "     differences that are not allowed. */",
  "  function ckgMember(r) {",
  "    return { name: r.name, summary: r.summary, shape: r.shape, settings: r.settings };",
  "  }",
  "",
  "  /**",
  "   * Bin rows into categories, alphabetically within each.",
  "   *",
  "   * The browser twin of groupByCategory in categories.mjs, which the build uses. It is a twin",
  "   * rather than a copy: the category keys, labels and questions are handed in from build time,",
  "   * derived from categories.mjs, so the LIST is never restated here — only the binning is, and",
  "   * the type's verifier asserts the two produce identical groups over a corpus that includes",
  "   * strays, empty categories and duplicate names.",
  "   *",
  "   * Empty categories are omitted rather than shown empty: an empty heading implies a category",
  "   * the reader has to check when the truthful state is that nothing is there yet. A row whose",
  "   * category is missing or unknown lands in the stray bin, which is deliberately ugly, because",
  "   * an uncategorised type is invisible in this gallery and that is a defect to fix rather than",
  "   * a kind of card to live with.",
  "   */",
  "  function ckgGroup(rows, cats, stray) {",
  "    var bins = {}, strays = [], out = [], i, r, key, members;",
  "    for (i = 0; i < cats.length; i++) bins[' ' + cats[i].k] = [];",
  "    for (i = 0; i < rows.length; i++) {",
  "      r = rows[i];",
  "      key = ' ' + r.category;",
  "      if (typeof r.category === 'string' && Object.prototype.hasOwnProperty.call(bins, key)) {",
  "        bins[key].push(ckgMember(r));",
  "      } else strays.push(ckgMember(r));",
  "    }",
  "    for (i = 0; i < cats.length; i++) {",
  "      members = bins[' ' + cats[i].k];",
  "      members.sort(ckgByName);",
  "      if (members.length > 0) {",
  "        out.push({ key: cats[i].k, label: cats[i].label, question: cats[i].q, members: members });",
  "      }",
  "    }",
  "    if (strays.length > 0) {",
  "      strays.sort(ckgByName);",
  "      out.push({ key: stray.k, label: stray.label, question: stray.q, members: strays });",
  "    }",
  "    return out;",
  "  }"
].join('\n');

/**
 * The markup half of the renderer, as browser source.
 *
 * Split from {@link MODEL_SRC} only for reading; the two are concatenated into one script and one
 * `new Function` body. Everything below produces an HTML string, and every value that came from
 * outside goes through `ckgEsc` on the way in.
 *
 * The disclosure elements are real `<details>` and `<summary>`, not a div wearing a class. They
 * are keyboard reachable and announced correctly by a screen reader for free, and — the reason
 * that actually decides it — they fold with no script at all, which is what makes the static
 * fallback a usable card rather than a wall of 300 open rows.
 */
const MARKUP_SRC = [
  "  /**",
  "   * One type: the name, the one line that says what it is FOR, and a fold holding the rest.",
  "   *",
  "   * The order is the whole argument of this card. A newcomer reads a name and a sentence and",
  "   * never has to meet the word 'shape'; someone who knows the catalogue opens the fold and gets",
  "   * the data literal, the settings, and a command they can paste. Leading with the data shape",
  "   * would be leading with the answer to a question the newcomer has not asked yet.",
  "   */",
  "  function ckgItem(t, dup) {",
  "    var nm = ckgEsc(t.name);",
  "    var slug = ckgSlug(t.name);",
  "    var sum = t.summary ? ckgEsc(t.summary) : '<i class=\"ck-g-dim\">no summary declared</i>';",
  "    var shape = t.shape ? ckgEsc(t.shape) : '';",
  "    var sets = t.settings.length > 0 ? ckgEsc(t.settings.join(' \\u00b7 ')) : '';",
  "    var cmd = ckgEsc('node cardkit/newcard.mjs ' + t.name + ' my-' + slug +",
  "                     ' --data ' + slug + '.json --ord 40');",
  "    var inline = shape ? '<code class=\"ck-g-inline\">' + shape + '</code>' : '';",
  "    /* A duplicate name is not a display choice, it is a defect: two files claiming one name",
  "       means one of them can never be reached by node newcard.mjs. Said in the row rather than",
  "       swallowed, for the same reason the uncategorised bin is shown. */",
  "    var flag = dup ? '<span class=\"ck-g-flag\">duplicate name</span>' : '';",
  "",
  "    return '<li class=\"ck-g-item\" data-q=\"' + ckgEsc(ckgHay(t)) + '\">' +",
  "      '<details class=\"ck-g-type\">' +",
  "        '<summary class=\"ck-g-head\">' +",
  "          '<span class=\"ck-g-name\">' + nm + '</span>' + flag +",
  "          '<span class=\"ck-g-sum\">' + sum + '</span>' + inline +",
  "        '</summary>' +",
  "        '<div class=\"ck-g-detail\">' +",
  "          '<div class=\"ck-g-fact\"><span class=\"ck-g-k\">data</span>' +",
  "            '<code class=\"ck-scroll ck-g-shape\">' +",
  "            (shape || '<i class=\"ck-g-dim\">no shape declared</i>') + '</code></div>' +",
  "          '<div class=\"ck-g-fact\"><span class=\"ck-g-k\">settings</span>' +",
  "            '<span class=\"ck-g-sets\">' + (sets || '<i class=\"ck-g-dim\">none</i>') +",
  "            '</span></div>' +",
  "          '<div class=\"ck-g-fact\"><span class=\"ck-g-k\">make one</span>' +",
  "            '<span class=\"ck-g-cmd\"><code class=\"ck-g-cmd-t\">' + cmd + '</code>' +",
  "            /* A word, not a drawn glyph, and against the desk's usual habit. The clipboard",
  "               icon every other copy control here uses is about 330 bytes of path data, and at",
  "               three hundred types that is a hundred kilobytes of duplicated decoration on a",
  "               control that already carries a word — the same word that becomes the feedback",
  "               when the copy lands. The glyph was buying nothing the label was not. */",
  "            '<button type=\"button\" class=\"ck-g-copy\" aria-label=\"copy the command for ' + nm +",
  "            '\"><span class=\"ck-g-copy-t\">copy</span></button>' +",
  "            '</span></div>' +",
  "        '</div>' +",
  "      '</details></li>';",
  "  }",
  "",
  "  /**",
  "   * One category: its label, the question it answers, how many types are in it, and the members.",
  "   *",
  "   * Closed. Every one of them, always, on first render — the fold is what lets a catalogue of",
  "   * three hundred types be read by someone who has met none of them. The question sits in the",
  "   * summary because it is the part that needs no vocabulary, and it is what a newcomer is",
  "   * actually holding when they arrive.",
  "   */",
  "  function ckgSection(g, dups) {",
  "    var body = '', i, m;",
  "    for (i = 0; i < g.members.length; i++) {",
  "      m = g.members[i];",
  "      body += ckgItem(m, Object.prototype.hasOwnProperty.call(dups, ' ' + m.name));",
  "    }",
  "    return '<details class=\"ck-g-cat\" data-cat=\"' + ckgEsc(g.key) + '\">' +",
  "      '<summary class=\"ck-g-cat-head\">' +",
  "        '<span class=\"ck-g-cat-label\">' + ckgEsc(g.label) + '</span>' +",
  "        '<span class=\"ck-g-cat-q\">' + ckgEsc(g.question) + '</span>' +",
  "        '<span class=\"ck-g-cat-n\">' + g.members.length + '</span>' +",
  "      '</summary>' +",
  "      '<ul class=\"ck-g-members\">' + body + '</ul></details>';",
  "  }",
  "",
  "  /** The whole list. Zero groups renders a sentence rather than a blank, because an empty page",
  "      is indistinguishable from a broken one. */",
  "  function ckgList(groups) {",
  "    var seen = {}, dups = {}, out = '', i, j, k;",
  "    for (i = 0; i < groups.length; i++) {",
  "      for (j = 0; j < groups[i].members.length; j++) {",
  "        k = ' ' + groups[i].members[j].name;",
  "        if (Object.prototype.hasOwnProperty.call(seen, k)) dups[k] = 1;",
  "        else seen[k] = 1;",
  "      }",
  "    }",
  "    for (i = 0; i < groups.length; i++) out += ckgSection(groups[i], dups);",
  "    if (out === '') {",
  "      out = '<p class=\"ck-g-void\">No card types. The catalogue answered, and it is empty \\u2014 ' +",
  "            'which is either a very new checkout or a types/ directory nothing can read.</p>';",
  "    }",
  "    return out;",
  "  }",
  "",
  "  /**",
  "   * The banner for files the catalogue could not load.",
  "   *",
  "   * A type whose module throws on import is missing from this list, and a list that is quietly",
  "   * short is the worst thing an index can be. Both plausible spellings of the endpoint's answer",
  "   * are read — a bare filename, or an object carrying a name and a reason — because guessing",
  "   * wrong should mean saying less, never saying nothing.",
  "   */",
  "  function ckgWarn(u) {",
  "    var names = [], i, e, name, why;",
  "    if (!ckgIsArr(u)) return '';",
  "    for (i = 0; i < u.length; i++) {",
  "      e = u[i];",
  "      if (e === null || e === undefined) continue;",
  "      if (typeof e === 'string') { names.push(e); continue; }",
  "      if (typeof e !== 'object') { names.push(String(e)); continue; }",
  "      name = ckgStr(e.name) || ckgStr(e.file) || ckgStr(e.type) || 'an unnamed file';",
  "      why = ckgStr(e.error) || ckgStr(e.reason) || ckgStr(e.message);",
  "      names.push(why ? name + ' (' + why + ')' : name);",
  "    }",
  "    if (names.length === 0) return '';",
  "    return '<p class=\"ck-g-warn-t\">' +",
  "      ckgPlural(names.length, 'file in types/ could not be read', 'files in types/ could not be read') +",
  "      ', so ' + (names.length === 1 ? 'that type is' : 'those types are') +",
  "      ' missing from this list: ' + ckgEsc(names.join(' \\u00b7 ')) + '</p>';",
  "  }"
].join('\n');

export const RENDER_SRC = MODEL_SRC + '\n\n' + MARKUP_SRC;

/**
 * The renderer, alive in Node.
 *
 * `RENDER_SRC` is a build-time constant of this module's own writing — nothing is interpolated
 * into it — so evaluating it here is the mechanism that makes the static fallback and the live
 * repaint the same code rather than two versions of it. It also means importing this module
 * proves the emitted script parses, before any card is ever built.
 *
 * @example render.esc('a<b');   // 'a&lt;b'
 * @example render.slug('Bee Swarm!');   // 'bee-swarm'
 */
export const render = new Function(
  RENDER_SRC + '\nreturn { esc: ckgEsc, slug: ckgSlug, plural: ckgPlural, hay: ckgHay,' +
               ' rows: ckgRows, group: ckgGroup, list: ckgList, warn: ckgWarn };'
)();

/* ── the browser half ─────────────────────────────────────────────────────────────────────── */

/**
 * The card's browser half: fetching, filtering and folding. Rendering only once, on a live read.
 *
 * Two performance rules are load-bearing here rather than tidy, because this card is expected to
 * hold three hundred rows within a year:
 *
 *   - **One delegated listener**, on the section, for every copy button in the card. Three hundred
 *     rows must not mean three hundred listeners, and delegation survives the repaint that
 *     replaces every row without re-wiring anything.
 *   - **The tree is never rebuilt on a keystroke.** Filtering sets `hidden` on rows that already
 *     exist and leaves the DOM alone otherwise. The haystack for each row is read once, at index
 *     time, into a plain array — three hundred `indexOf` calls per keystroke is nothing, three
 *     hundred `getAttribute` calls is the difference between typing smoothly and stuttering.
 *
 * Written as one string and wrapped in a function expression by {@link build}, so nothing this
 * card defines reaches the global scope: a desk can hold two galleries, and a top-level `var`
 * would have them sharing it.
 *
 * @param id the card's `data-card` value, embedded as a literal
 * @param cats the category descriptors, derived from categories.mjs at build time
 * @param stray the descriptor for the uncategorised bin, also derived rather than restated
 * @param builtAt when the baked snapshot was taken, said out loud when the endpoint is down
 *
 * @example main('gallery', [], { k: 'x' }, 'now').indexOf('CK.build') >= 0;   // true
 */
function main(id, cats, stray, builtAt) {
  return [
    "  var CKG_CATS  = " + embed(cats) + ";",
    "  var CKG_STRAY = " + embed(stray) + ";",
    "  var CKG_DEF   = " + embed(defaults) + ";",
    "  var CKG_AT    = " + embed(builtAt) + ";",
    "",
    "  CK.build(" + jsStr(id) + ", function (sec) {",
    "    var list  = sec.querySelector('.ck-g-list');",
    "    var warn  = sec.querySelector('.ck-g-warn');",
    "    var find  = sec.querySelector('.ck-g-find');",
    "    var count = sec.querySelector('.ck-g-count');",
    "    var none  = sec.querySelector('.ck-g-none');",
    "    var note  = sec.querySelector('.ck-g-note');",
    "    if (!list) return;",
    "",
    "    var items = [], cats = [];",
    "    var state = { q: '', filtering: false, live: true, fresh: false, busy: false, openAll: null };",
    "",
    "    /* One pass over the rendered tree. Re-run after a repaint and never per keystroke. */",
    "    function index() {",
    "      var boxes = list.querySelectorAll('.ck-g-cat'), i, j, lis, cat;",
    "      items = [];",
    "      cats = [];",
    "      for (i = 0; i < boxes.length; i++) {",
    "        cat = { el: boxes[i], nEl: boxes[i].querySelector('.ck-g-cat-n'),",
    "                total: 0, hits: 0, wasOpen: false };",
    "        lis = boxes[i].querySelectorAll('.ck-g-item');",
    "        for (j = 0; j < lis.length; j++) {",
    "          items.push({ el: lis[j], cat: cat, hay: lis[j].getAttribute('data-q') || '' });",
    "        }",
    "        cat.total = lis.length;",
    "        cats.push(cat);",
    "      }",
    "    }",
    "",
    "    /* Honest in both directions. Not filtering, it reports the size of the catalogue; while",
    "       filtering it reports the hit count against that size, so a filter that is hiding most",
    "       of the deck says so rather than looking like a small catalogue. */",
    "    function say(shown) {",
    "      if (!count) return;",
    "      if (state.q === '') {",
    "        count.textContent = items.length === 0 ? 'no types'",
    "          : ckgPlural(items.length, 'type', 'types') + ' in ' +",
    "            ckgPlural(cats.length, 'category', 'categories');",
    "      } else {",
    "        count.textContent = 'showing ' + shown + ' of ' + ckgPlural(items.length, 'type', 'types');",
    "      }",
    "    }",
    "",
    "    function apply() {",
    "      var i, j, c, hit, shown = 0;",
    "",
    "      if (state.q === '') {",
    "        for (i = 0; i < items.length; i++) items[i].el.hidden = false;",
    "        for (j = 0; j < cats.length; j++) {",
    "          c = cats[j];",
    "          c.el.hidden = false;",
    "          if (c.nEl) c.nEl.textContent = String(c.total);",
    "          /* Clearing the filter puts the folds back where the reader left them, not where",
    "             the search dragged them open. */",
    "          if (state.filtering) c.el.open = c.wasOpen;",
    "        }",
    "        state.filtering = false;",
    "        shown = items.length;",
    "      } else {",
    "        if (!state.filtering) {",
    "          for (j = 0; j < cats.length; j++) cats[j].wasOpen = !!cats[j].el.open;",
    "          state.filtering = true;",
    "        }",
    "        for (j = 0; j < cats.length; j++) cats[j].hits = 0;",
    "        for (i = 0; i < items.length; i++) {",
    "          hit = items[i].hay.indexOf(state.q) >= 0;",
    "          items[i].el.hidden = !hit;",
    "          if (hit) { shown++; items[i].cat.hits++; }",
    "        }",
    "        for (j = 0; j < cats.length; j++) {",
    "          c = cats[j];",
    "          /* A category with no hit is hidden rather than shown empty, and one with a hit is",
    "             opened, so a search never asks the reader to go fishing through folds. */",
    "          c.el.hidden = c.hits === 0;",
    "          if (c.hits > 0) c.el.open = true;",
    "          if (c.nEl) c.nEl.textContent = c.hits + ' of ' + c.total;",
    "        }",
    "      }",
    "",
    "      if (none) {",
    "        none.hidden = !(state.q !== '' && shown === 0);",
    "        /* A filter that matches nothing says so. An empty page is indistinguishable from a",
    "           broken one, and the reader's next move is to reload rather than to retype. */",
    "        if (!none.hidden) {",
    "          none.textContent = 'Nothing matches \\u201c' + state.q + '\\u201d. Try a shorter word, ' +",
    "            'or clear the filter and browse by the question each category asks.';",
    "        }",
    "      }",
    "      say(shown);",
    "    }",
    "",
    "    function fold(open) {",
    "      var j;",
    "      for (j = 0; j < cats.length; j++) { cats[j].el.open = open; cats[j].wasOpen = open; }",
    "    }",
    "",
    "    function tell(msg) { if (note) note.textContent = msg; }",
    "",
    "    function reason(e) {",
    "      var m = e && e.message ? String(e.message) : String(e);",
    "      return m.length > 80 ? m.slice(0, 80) : m;",
    "    }",
    "",
    "    /* The endpoint is down, or lying. The static list stays exactly as it was and the caption",
    "       stops claiming to be live: a stale index that presents itself as current is worse than",
    "       no index, because nobody goes looking for the type it failed to mention. */",
    "    function fell(why) {",
    "      state.busy = false;",
    "      tell('/cardtypes did not answer (' + why + ') \\u2014 this is the snapshot baked into the ' +",
    "           'card at ' + CKG_AT + ', so a type added since then is not listed here.');",
    "    }",
    "",
    "    function paint(payload) {",
    "      var rows = ckgRows(payload);",
    "      var groups = ckgGroup(rows, CKG_CATS, CKG_STRAY);",
    "      var at = payload && typeof payload.at === 'string' ? payload.at.slice(0, 40) : '';",
    "      list.innerHTML = ckgList(groups);",
    "      if (warn) warn.innerHTML = ckgWarn(payload ? payload.unreadable : null);",
    "      index();",
    "      if (state.openAll) fold(true);",
    "      apply();",
    "      state.fresh = true;",
    "      state.busy = false;",
    "      tell('read from /cardtypes' + (at ? ', generated ' + at : '') + ' \\u2014 types/ is read ' +",
    "           'from disk on every request, so a file dropped in appears on the next look.');",
    "    }",
    "",
    "    /* Plain fetch, not CK.net: this is the desk's own server answering about its own",
    "       directory, same origin, no allowlist to consult and no proxy to go through. */",
    "    function load() {",
    "      if (state.busy || state.fresh) return;",
    "      if (typeof fetch !== 'function') { fell('this browser has no fetch'); return; }",
    "      state.busy = true;",
    "      fetch('/cardtypes', { cache: 'no-store' }).then(function (r) {",
    "        if (!r.ok) { fell('HTTP ' + r.status); return null; }",
    "        return r.text();",
    "      }, function (e) { fell(reason(e)); return null; }).then(function (body) {",
    "        if (body === null || body === undefined) return;",
    "        /* A slow reply that lands after the desk swapped <main> belongs to a section that is",
    "           no longer on the page; painting it would be writing into a detached tree. */",
    "        if (sec.isConnected === false) { state.busy = false; return; }",
    "        var payload;",
    "        try { payload = JSON.parse(body); }",
    "        catch (e) { fell('the reply was not JSON'); return; }",
    "        try { paint(payload); } catch (e) { fell(reason(e)); }",
    "      }, function (e) { fell(reason(e)); });",
    "    }",
    "",
    "    function copy(btn) {",
    "      var box = btn.parentNode;",
    "      var cmdEl = box ? box.querySelector('.ck-g-cmd-t') : null;",
    "      var lab = btn.querySelector('.ck-g-copy-t');",
    "      if (!cmdEl) return;",
    "",
    "      function said(m) {",
    "        if (!lab) return;",
    "        lab.textContent = m;",
    "        setTimeout(function () { lab.textContent = 'copy'; }, 1400);",
    "      }",
    "",
    "      /* Selecting the text is the fallback rather than a silent failure. A copy button that",
    "         does nothing is worse than no copy button: the reader walks away believing the",
    "         command is on the clipboard. */",
    "      function pick() {",
    "        try {",
    "          var r = document.createRange(), s = window.getSelection();",
    "          r.selectNodeContents(cmdEl);",
    "          s.removeAllRanges();",
    "          s.addRange(r);",
    "          said('selected \\u2014 copy it');",
    "        } catch (no) { said('copy failed'); }",
    "      }",
    "",
    "      if (navigator.clipboard && navigator.clipboard.writeText) {",
    "        navigator.clipboard.writeText(cmdEl.textContent).then(function () { said('copied'); }, pick);",
    "      } else pick();",
    "    }",
    "",
    "    CK.once(sec, 'wire', function () {",
    "      if (find) {",
    "        find.addEventListener('input', function () {",
    "          state.q = find.value.trim().toLowerCase();",
    "          apply();",
    "        });",
    "        find.addEventListener('keydown', function (ev) {",
    "          if (ev.key !== 'Escape' || find.value === '') return;",
    "          find.value = '';",
    "          state.q = '';",
    "          apply();",
    "        });",
    "      }",
    "      /* One listener for every copy button the card will ever hold, now or after a repaint. */",
    "      sec.addEventListener('click', function (ev) {",
    "        var t = ev.target;",
    "        var btn = t && t.closest ? t.closest('.ck-g-copy') : null;",
    "        if (!btn) return;",
    "        ev.preventDefault();",
    "        copy(btn);",
    "      });",
    "    });",
    "",
    "    index();",
    "    apply();",
    "",
    "    CK.settings(sec, CKG_DEF, function (cfg) {",
    "      sec.classList.toggle('ck-g-shapes', !!cfg.shapes);",
    "      /* Only when it CHANGES. Re-folding on every settings edit would slam shut the",
    "         categories the reader had just opened, for touching an unrelated checkbox. */",
    "      if (state.openAll !== !!cfg.openAll) { state.openAll = !!cfg.openAll; fold(state.openAll); }",
    "      state.live = !!cfg.live;",
    "      apply();",
    "      if (state.live) load();",
    "      else if (!state.fresh) {",
    "        tell('live refresh is off in this card\\u2019s settings \\u2014 showing the snapshot ' +",
    "             'baked in at ' + CKG_AT + '.');",
    "      }",
    "    });",
    "  });"
  ].join('\n');
}

/* ── the build ────────────────────────────────────────────────────────────────────────────── */

/**
 * The category descriptors the emitted script groups by, derived from `categories.mjs`.
 *
 * Derived, never restated. The browser cannot import an ES module from a classic script, so the
 * ten categories have to travel to it somehow; generating them at build time from the one written
 * source means a category renamed in `categories.mjs` is renamed here on the next build, and a
 * category added there appears here without anyone editing this file.
 *
 * @example CATS[0].q;   // 'What does the spread look like?'
 */
const CATS = CATEGORY_KEYS.map((k) => ({ k, label: categoryLabel(k), q: CATEGORIES[k] }));

/**
 * The uncategorised bin's key, label and question — also derived, by asking `groupByCategory`.
 *
 * A type with no category is a defect, and the bin that holds it is deliberately ugly. Its exact
 * wording lives in `categories.mjs`; rather than copy the sentence, this hands that function one
 * category-less row and reads back what it called the bin. One written source, two readers.
 *
 * @example STRAY.label;   // 'Uncategorised'
 */
const STRAY = (() => {
  const bin = groupByCategory([['probe', { meta: {} }]])[0];
  return { k: bin.key, label: bin.label, q: bin.question };
})();

/**
 * A build timestamp a person can read, from an ISO string or from now.
 *
 * Minutes, not seconds: this is shown to say how stale a fallback list is, and nobody has ever
 * needed that to the second. UTC is named rather than assumed, because a desk is often open on
 * two machines in two places.
 *
 * @param at an ISO timestamp, or anything else, in which case the clock is used
 *
 * @example stamp('2026-08-29T16:20:11.000Z');   // '2026-08-29 16:20 UTC'
 */
function stamp(at) {
  const iso = typeof at === 'string' && at.trim() ? at.trim() : new Date().toISOString();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] + ' ' + m[2] + ' UTC' : iso.slice(0, 40);
}

/**
 * Turn endpoint-shaped rows into the `[name, module]` pairs `groupByCategory` reads.
 *
 * The endpoint reports a type's settings as a list of names, while a real module reports them as
 * a `defaults` object; `groupByCategory` takes the module's side, so this rebuilds a stand-in
 * object with those keys. The values are meaningless and are `null` on purpose — the only thing
 * read back is `Object.keys`.
 *
 * The stand-in is made with a null prototype so a setting genuinely called `__proto__` becomes an
 * own key instead of silently reassigning the object's prototype and vanishing from the listing.
 *
 * @param rows objects carrying `name`, `summary`, `shape`, `category` and `settings`
 * @returns pairs suitable for `groupByCategory`
 *
 * @example toPairs([{ name: 'pie', settings: ['ring'] }])[0][1].meta.defaults;   // { ring: null }
 */
function toPairs(rows) {
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const stand = Object.create(null);
      for (const k of Array.isArray(r.settings) ? r.settings : []) {
        if (typeof k === 'string') stand[k] = null;
      }
      const name = typeof r.name === 'string' && r.name.trim() ? r.name : '(unnamed)';
      return [name, { meta: { summary: r.summary, shape: r.shape, category: r.category, defaults: stand } }];
    });
}

/**
 * Read whatever `build` was handed into `[name, module]` pairs.
 *
 * Four spellings are accepted because four are genuinely useful and the alternative is a caller
 * writing the adapter itself: the `Map` `catalogue()` returns, the pairs that come out of it, the
 * endpoint's `{ types }` envelope, and a bare array of endpoint rows. Anything else — including
 * nothing at all, which is how the contract's validator calls every type — yields no rows and an
 * honest empty card rather than a throw.
 *
 * @param data whatever the caller passed as the card's data
 *
 * @example fromData(new Map([['pie', { meta: { category: 'part-of-a-whole' } }]])).length;   // 1
 * @example fromData(undefined).length;   // 0
 */
function fromData(data) {
  if (!data) return [];
  if (data instanceof Map) return [...data];
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    return Array.isArray(data[0]) ? data : toPairs(data);
  }
  if (typeof data === 'object' && Array.isArray(data.types)) return toPairs(data.types);
  return [];
}

/**
 * Read the live catalogue and return it in exactly the shape `GET /cardtypes` returns.
 *
 * `build` is synchronous by contract and `catalogue()` is not, so the build-time snapshot cannot
 * be taken inside `build`; this is how it is taken instead, and returning the endpoint's own shape
 * means the card has one shape to normalise rather than two.
 *
 * `newcard.mjs` is imported lazily, inside the call, rather than at the top of this module. That
 * is not style: `catalogue()` imports every file in `types/`, including this one, and a static
 * import here would make the cycle load-bearing — a module that cannot finish evaluating until a
 * function that imports it has finished running.
 *
 * `unreadable` comes back empty because `catalogue()` reports a module that fails to load on
 * stderr and moves on rather than returning it. The field exists so the endpoint's answer and the
 * snapshot are the same shape, and the card renders whatever the endpoint puts there.
 *
 * @returns `{ types, unreadable, at }`, types sorted by name
 *
 * @example (await snapshot()).types[0].name;   // 'agentboard'
 */
export async function snapshot() {
  const { catalogue } = await import('../newcard.mjs');
  const cat = await catalogue();
  const types = [...cat]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, mod]) => {
      const m = (mod && mod.meta) || {};
      return {
        name,
        summary: typeof m.summary === 'string' ? m.summary : '',
        shape: typeof m.shape === 'string' ? m.shape : '',
        category: typeof m.category === 'string' ? m.category : null,
        contains: m.contains === true,
        settings: Object.keys(m.defaults || {}),
      };
    });
  return { types, unreadable: [], at: new Date().toISOString() };
}

/**
 * Build one gallery card.
 *
 * The markup that comes out is a complete, working catalogue with no script at all: every
 * category is a real `<details>`, folded, and every type is a real `<details>` inside it. That is
 * the fallback, and it is also what a reader sees for the few milliseconds before the fetch
 * lands. The script's job is to replace it with a live read, or to leave it alone and say in the
 * caption that it is a snapshot and when it was taken.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  the catalogue to bake in: `{ types, unreadable, at }` as `GET /cardtypes` returns
 *   it, a `Map` from `catalogue()`, `[name, module]` pairs, or a bare array of type rows. Absent
 *   data is not an error — the card renders empty and says it will ask the server. Every value in
 *   it is untrusted and escaped.
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the emitted script is not a classic script — which would blank the whole
 *   desk rather than only this card, since every card's `js` becomes one inline block
 *
 * @example
 * build({ id: 'gallery', title: 'the catalogue', ord: 15, data: await snapshot() })
 *   .html.indexOf('data-cat="geographic"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const pairs = fromData(data);
  const groups = groupByCategory(pairs);
  const total = groups.reduce((n, g) => n + g.members.length, 0);

  const at = data && typeof data === 'object' && !Array.isArray(data) && !(data instanceof Map)
    ? data.at : null;
  const built = stamp(at);

  const esc = render.esc;
  const listHtml = render.list(groups);
  const warnHtml = render.warn(data && !Array.isArray(data) && !(data instanceof Map)
    ? data.unreadable : null);

  const countText = total === 0
    ? 'no types'
    : render.plural(total, 'type', 'types') + ' in ' +
      render.plural(groups.length, 'category', 'categories');

  /* The provenance line is never optional and never vague. A catalogue that cannot say whether it
     is current is a catalogue you have to go and check by hand, which is the job it existed to
     save you. */
  const noteText = total === 0
    ? 'nothing was baked into this card — it asks /cardtypes for the catalogue when its script runs.'
    : 'snapshot baked into this card at ' + built + ' — not yet read from the server.';

  const html =
    '<section data-card="' + esc(id) + '" class="ck-gallery">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-live">read live</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-live" name="live">\n' +
    '    <label for="' + esc(id) + '-openAll">start unfolded</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-openAll" name="openAll">\n' +
    '    <label for="' + esc(id) + '-shapes">show data shapes</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-shapes" name="shapes">\n' +
    '    <div class="ck-set-foot">read live re-reads types/ from the server on every load; ' +
    'turning it off pins the list baked in at build time. start unfolded and show data shapes ' +
    'are for readers who already know the catalogue.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-g-tools">\n' +
    '    <input type="search" class="ck-g-find" placeholder="filter by name, summary or data shape"' +
    ' aria-label="filter card types" autocomplete="off" spellcheck="false">\n' +
    '    <span class="ck-g-count" role="status" aria-live="polite">' + esc(countText) + '</span>\n' +
    '  </div>\n' +
    '  <div class="ck-g-warn">' + warnHtml + '</div>\n' +
    '  <div class="ck-g-list">' + listHtml + '</div>\n' +
    '  <p class="ck-g-none" hidden></p>\n' +
    '  <div class="ck-cap">\n' +
    '    <i class="ck-g-note">' + esc(noteText) + '</i>\n' +
    '    <span class="ck-aside">Each category asks one question; open it to meet the types that ' +
    'answer it. A type’s own fold carries the data it takes, the settings it understands, and ' +
    'the command that makes one.</span>\n' +
    '  </div>\n' +
    '</section>\n';

  const js = assertClassic(
    '(function () {\n' + RENDER_SRC + '\n\n' + main(id, CATS, STRAY, built) + '\n})();\n', 'js');

  return { json: { ord: Number.isFinite(ord) ? ord : 0, types: total, at: built }, html, css: CSS, js };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch is
   the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The desk
   is one document open in two viewers who want different answers, and the OS only knows how to
   give both of them the same one.

   Nothing between these two backticks may contain a third. A backtick inside a CSS comment here
   closes the literal early and the rest of the stylesheet is parsed as JavaScript — which is not
   hypothetical, it happened on this file's first build, in a comment naming a setting. The type's
   verifier scans this string for one. */
const CSS = `
  .ck-gallery { position: relative; }

  /* Native disclosure, with our own marker. The UA triangle is a different shape and a different
     size on every engine, and it sits where the engine wants rather than where the row wants. */
  .ck-gallery summary { cursor: pointer; list-style: none; }
  .ck-gallery summary::-webkit-details-marker { display: none; }
  .ck-gallery summary:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }

  .ck-gallery .ck-g-cat-head, .ck-gallery .ck-g-head { position: relative; padding-left: 15px; }
  .ck-gallery .ck-g-cat-head::before, .ck-gallery .ck-g-head::before {
    content: ""; position: absolute; left: 3px; top: 50%; width: 0; height: 0;
    margin-top: -4px; color: var(--ink-faint);
    border-left: 4.5px solid currentColor;
    border-top: 4px solid transparent; border-bottom: 4px solid transparent;
    transform-origin: 2px 4px; transition: transform .12s;
  }
  .ck-gallery details[open] > summary::before { transform: rotate(90deg); }
  .ck-gallery summary:hover::before { color: var(--accent); }

  /* ── the filter ─────────────────────────────────────────────────────────────────────── */

  .ck-gallery .ck-g-tools { display: flex; align-items: center; gap: 9px; margin: 10px 0 8px; }
  .ck-gallery .ck-g-find {
    flex: 1 1 auto; min-width: 0; box-sizing: border-box;
    font: inherit; font-family: var(--mono); font-size: 11px; padding: 5px 8px;
    background: var(--well); color: var(--ink);
    border: 1px solid var(--hairline); border-radius: 5px;
  }
  .ck-gallery .ck-g-find:focus { outline: none; border-color: var(--accent); }
  .ck-gallery .ck-g-find::placeholder { color: var(--ink-faint); }
  .ck-gallery .ck-g-count {
    flex: none; font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  /* ── the categories ─────────────────────────────────────────────────────────────────── */

  .ck-gallery .ck-g-cat { border-top: 1px solid var(--hairline); }
  .ck-gallery .ck-g-cat:last-of-type { border-bottom: 1px solid var(--hairline); }
  .ck-gallery .ck-g-cat-head {
    display: flex; align-items: center; flex-wrap: wrap; gap: 2px 9px; padding: 8px 2px 8px 15px;
  }
  .ck-gallery .ck-g-cat-label {
    font: 700 10px/1.5 var(--ui); letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink); flex: none;
  }
  /* The question, not the label, is the part a newcomer can act on, so it gets the readable
     size and the room to sit on its own line when the card is narrow. */
  .ck-gallery .ck-g-cat-q { flex: 1 1 14ch; font-size: 12px; color: var(--ink-dim); }
  .ck-gallery .ck-g-cat-n {
    flex: none; font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .ck-gallery .ck-g-cat[open] > .ck-g-cat-head .ck-g-cat-label { color: var(--accent); }

  /* ── one type ───────────────────────────────────────────────────────────────────────── */

  .ck-gallery .ck-g-members { list-style: none; margin: 0 0 6px; padding: 0 0 0 13px; }
  .ck-gallery .ck-g-item + .ck-g-item { border-top: 1px solid var(--hairline); }
  .ck-gallery .ck-g-head {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 5px 2px;
  }
  .ck-gallery .ck-g-name {
    flex: none; font-family: var(--mono); font-size: 11.5px; color: var(--accent);
  }
  .ck-gallery .ck-g-sum { flex: 1 1 16ch; font-size: 12px; color: var(--ink-dim); line-height: 1.45; }
  .ck-gallery .ck-g-dim { color: var(--ink-faint); font-style: normal; }
  .ck-gallery .ck-g-flag {
    flex: none; font-family: var(--mono); font-size: 9px; color: var(--ck-s1);
    border: 1px solid var(--pill-edge); border-radius: 3px; padding: 0 4px;
  }

  /* The shape, lifted into the row by the shapes setting. Rendered always and revealed by a
     class, so turning it on never has to rebuild three hundred rows. */
  .ck-gallery .ck-g-inline {
    display: none; flex: 1 1 100%; overflow-x: auto; overscroll-behavior-x: contain;
    font-family: var(--mono); font-size: 10px; color: var(--ink-faint); white-space: pre;
  }
  .ck-gallery.ck-g-shapes .ck-g-inline { display: block; }

  .ck-gallery .ck-g-detail { padding: 1px 0 9px 0; display: grid; gap: 5px; }
  .ck-gallery .ck-g-fact { display: grid; grid-template-columns: 58px 1fr; gap: 9px; align-items: start; }
  .ck-gallery .ck-g-k {
    font: 700 9px/1.7 var(--ui); letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  /* A shape can be a hundred characters wide. It scrolls inside its own box; the desk column
     never scrolls sideways. */
  .ck-gallery .ck-g-shape {
    display: block; white-space: pre; font-family: var(--mono); font-size: 10.5px;
    color: var(--ink); line-height: 1.5;
  }
  .ck-gallery .ck-g-sets { font-family: var(--mono); font-size: 10.5px; color: var(--ink-dim); }

  .ck-gallery .ck-g-cmd { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .ck-gallery .ck-g-cmd-t {
    flex: 1 1 auto; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain;
    white-space: pre; font-family: var(--mono); font-size: 10px; color: var(--ink-dim);
    background: var(--well); border: 1px solid var(--hairline); border-radius: 4px; padding: 3px 6px;
  }
  .ck-gallery .ck-g-copy {
    flex: none; display: inline-flex; align-items: center; gap: 4px;
    font: inherit; font-family: var(--mono); font-size: 9.5px; color: var(--ink-faint);
    background: transparent; border: 1px solid var(--pill-edge); border-radius: 4px;
    padding: 3px 6px; cursor: pointer;
  }
  .ck-gallery .ck-g-copy:hover { color: var(--accent); border-color: var(--accent); }

  /* ── what the card says when it has nothing to show ─────────────────────────────────── */

  .ck-gallery .ck-g-warn:empty { display: none; }
  .ck-gallery .ck-g-warn-t {
    margin: 0 0 8px; font-size: 11px; line-height: 1.5; color: var(--ck-s1);
    background: var(--well); border: 1px solid var(--hairline); border-radius: 5px; padding: 6px 9px;
  }
  .ck-gallery .ck-g-none, .ck-gallery .ck-g-void {
    margin: 12px 0 2px; font-size: 11.5px; line-height: 1.5; color: var(--ink-faint);
  }

  .ck-gallery .ck-g-note { color: var(--ink-dim); font-style: normal; display: block; }
  .ck-gallery .ck-cap .ck-aside { display: block; margin-top: 3px; }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box; it
     wants to be its own size, at the start of its column. */
  .ck-gallery .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  /* [hidden] and the display rules above it tie on specificity, and this sheet loads after the
     UA's, so a hidden row would stay visible without ever saying so. */
  .ck-gallery .ck-g-item[hidden], .ck-gallery .ck-g-cat[hidden] { display: none; }
  .ck-gallery [hidden] { display: none; }

  @media (prefers-reduced-motion: reduce) {
    /* The marker's turn is decoration; the open state carries the meaning. */
    .ck-gallery .ck-g-cat-head::before, .ck-gallery .ck-g-head::before { transition: none; }
  }
`;
