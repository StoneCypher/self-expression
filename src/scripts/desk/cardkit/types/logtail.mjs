/**
 * The 'logtail' card type - a live-following window on a file the desk is allowed to read.
 *
 * Everything here is shell. Unlike the table card, which renders its content in Node and lets the
 * browser rearrange it, a tail has no content at build time: the file it watches will have changed
 * by the time anyone looks at the card. So Node emits a frame and a caption that says "reading",
 * and the browser half fills it from GET /tail and keeps filling it.
 *
 * Three things in here are load-bearing and each is explained where it lives:
 *
 *   1. **Scroll pinning.** A tail that yanks the viewer back to the bottom every three seconds is
 *      a tail nobody can read anything in. See the comment above the scroll block in main().
 *   2. **Refusal is not emptiness.** The server answers 403 with a body that explains itself, and
 *      those words go into the caption unchanged. "The desk is not allowed to read that" and "the
 *      file has nothing in it" are different facts and must never render the same.
 *   3. **The escape introducer is a number, never a character.** ckAnsiStrip compares code points.
 *      Nothing in this file contains a control byte, and nothing in it contains an escape for one,
 *      so neither a corrupted editor round-trip nor an over-eager decode step can put one there.
 *
 * There is also a structural property this file keeps deliberately: it contains no backtick, not
 * in a string, not in a regular expression, not in a comment. A backtick that reaches the emitted
 * script is a template literal in a classic-script context, which is a parse error, and the whole
 * deck's scripts are one inline block - so one card's stray backtick blanks every card on the
 * desk. Building the CSS by joining an array instead of by template literal costs nothing and
 * makes the property checkable with a byte scan rather than with care.
 *
 * @see guardEmitted for the build-time refusal that enforces all of the above
 * @see TAIL_SRC for the browser-side helpers, shipped and tested as the same text
 */

/**
 * The lines-per-read choices, smallest first.
 *
 * Three rather than a free number: the interesting question is "a screenful, a session, or
 * everything", and a spinner inviting 1,437 invites a card that reads 1,437 lines every three
 * seconds for no reason anyone can name.
 *
 * @example LINE_CHOICES[1];   // 500
 */
export const LINE_CHOICES = [100, 500, 2000];

/**
 * The poll periods in seconds, smallest first.
 *
 * @example POLL_CHOICES[0];   // 2
 */
export const POLL_CHOICES = [2, 3, 10];

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Declared above meta so meta.defaults can be spread from it: the contract wants the settings
 * reachable on meta, and the emitter wants them as a named binding, and writing them twice is how
 * the two quietly stop agreeing.
 *
 * Following is on by default because a tail that does not follow is a very slow cat.
 *
 * @example defaults.interval;   // 3
 */
export const defaults = { lines: 500, follow: true, wrap: false, interval: 3 };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * @example meta.name;       // 'logtail'
 * @example meta.defaults;   // { lines: 500, follow: true, wrap: false, interval: 3 }
 */
export const meta = {
  name: 'logtail',
  summary: 'A live-following window on a file, with a filter, line numbers and severity markers.',
  shape: '{ path, lines, filter, follow, wrap } - path is a file inside one of the server\'s ' +
         'readable roots; lines is 100, 500 or 2000; filter seeds the filter box; ' +
         'follow and wrap seed the settings this card was authored with',
  defaults: { ...defaults }
};

/** A backtick, made rather than typed, so this file can be scanned for the character itself. */
const BQ = String.fromCharCode(96);

/**
 * HTML-escape a value, mirroring CK.esc byte for byte.
 *
 * Duplicated rather than imported because kit.js is a classic script and not a module. The two
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
 * JSON.stringify alone is not enough for text landing inside a script element: '</' would close
 * it, and U+2028 and U+2029 are line terminators to a JS parser but not to JSON. The backtick and
 * the question mark are escaped for a second reason - this type refuses to emit a script
 * containing either a template literal or optional chaining, and a file path holding a backtick
 * would trip that refusal with a message about a rule the author did not break. Cheaper to make
 * the data unable to spell the forbidden tokens at all than to explain why it must not.
 *
 * @param s the text to embed
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .split(BQ).join('\\u0060')
    .replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The per-card fallbacks, taken from the card's data where the data says something usable.
 *
 * A value outside the offered choices is discarded rather than clamped: a card authored with
 * lines: 1200 wanted a number this card does not offer, and quietly rounding it to 2000 makes the
 * settings panel disagree with the source that created it.
 *
 * These become the fallbacks handed to CK.settings, not the values in force - anything the viewer
 * has already chosen still wins, because a poll rate is a property of who is looking.
 *
 * @param d the card's data object, already known to be an object
 *
 * @example seed({ lines: 100, wrap: true }).lines;   // 100
 * @example seed({ lines: 1200 }).lines;              // 500
 */
function seed(d) {
  const out = { ...defaults };
  if (LINE_CHOICES.indexOf(Number(d.lines)) >= 0) out.lines = Number(d.lines);
  if (typeof d.follow === 'boolean') out.follow = d.follow;
  if (typeof d.wrap === 'boolean') out.wrap = d.wrap;
  return out;
}

/**
 * A copy of some JavaScript with every comment body and every string body replaced by spaces.
 *
 * Offsets and line numbers are preserved exactly - a blanked character becomes a space, and a
 * newline stays a newline - so anything found in the result is at the same place in the original.
 *
 * This exists because a keyword scan over raw source is a scan over English. A card was refused
 * tonight for a comment of its own that said "the class is what CSS reads", which is not a class
 * declaration and never was. A guard that cries wolf gets switched off, and a guard that has been
 * switched off is worse than no guard at all, because someone believes in it. The tokens that
 * CANNOT appear innocently - a backtick, an arrow, an optional chain - are still scanned raw.
 *
 * Backtick-quoted strings are deliberately not handled: they are rejected outright a step earlier,
 * so a template literal reaching this function is already the error it is about to be reported as.
 *
 * @param src the source to blank; regular expression literals are not tracked, and this type
 *            emits none, so a slash outside a comment is division or nothing
 *
 * @example blankNonCode('var a = "let x"; // let y').indexOf('let');   // -1
 */
function blankNonCode(src) {
  const out = [];
  const CODE = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4;
  let mode = CODE, i = 0;

  const put = (n, ch) => { for (let k = 0; k < n; k++) out.push(ch); };

  while (i < src.length) {
    const c = src[i], d = i + 1 < src.length ? src[i + 1] : '';

    if (mode === CODE) {
      if (c === '/' && d === '/') { put(2, ' '); i += 2; mode = LINE;  continue; }
      if (c === '/' && d === '*') { put(2, ' '); i += 2; mode = BLOCK; continue; }
      if (c === "'") { out.push(c); i += 1; mode = SQ; continue; }
      if (c === '"') { out.push(c); i += 1; mode = DQ; continue; }
      out.push(c); i += 1; continue;
    }

    if (mode === LINE) {
      if (c === '\n') { out.push(c); mode = CODE; } else out.push(' ');
      i += 1; continue;
    }

    if (mode === BLOCK) {
      if (c === '*' && d === '/') { put(2, ' '); i += 2; mode = CODE; continue; }
      out.push(c === '\n' ? c : ' '); i += 1; continue;
    }

    const quote = mode === SQ ? "'" : '"';
    if (c === '\\') { out.push(' '); if (d !== '') out.push(d === '\n' ? d : ' '); i += 2; continue; }
    if (c === quote) { out.push(c); i += 1; mode = CODE; continue; }
    out.push(c === '\n' ? c : ' '); i += 1;
  }

  return out.join('');
}

/**
 * Refuse to return a card whose emitted files would break the desk, by throwing.
 *
 * This is not belt and braces over the installer's own audit; it is the earlier of the two, and
 * the earlier one is the one that names the type that did it. The deck's scripts are concatenated
 * into ONE inline block, so a single modern-syntax token in one card is a parse error that blanks
 * every card on the page - and the symptom is an empty desk, which points at nothing.
 *
 * Two scans, on purpose. The backtick, the arrow and the optional chain are looked for in the raw
 * text, because none of them can turn up innocently in prose. The declaration keywords are looked
 * for only in code, with comments and string bodies blanked out first, because all three of them
 * are ordinary English words and a guard that fails a card for its own documentation is a guard
 * that gets deleted.
 *
 * The backtick itself is built from its code point rather than written, for exactly the reason
 * the check exists: a literal here would be a backtick in this file, and this file having none is
 * the property the check is defending.
 *
 * @param parts the html, css and js about to be returned
 * @returns nothing; it either says nothing or throws
 *
 * @throws {Error} naming every violation found, so one run fixes all of them
 *
 * @example guardEmitted({ html: '', css: '', js: 'var f = function () {};' });   // silent
 * @example guardEmitted({ html: '', css: '', js: 'var f = () => 1;' });          // throws
 * @example guardEmitted({ html: '', css: '', js: '/* the class of a row *\/' });  // silent
 */
export function guardEmitted(parts) {
  const bad = [];
  const js = parts.js || '', css = parts.css || '', html = parts.html || '';

  if (js.indexOf(BQ) >= 0) bad.push('a backtick, which is a template literal in a classic script');
  if (js.indexOf('=>') >= 0) bad.push('an arrow function');
  if (js.indexOf('?.') >= 0) bad.push('optional chaining');

  const code = blankNonCode(js);
  const decl = /(^|[^A-Za-z0-9_$])(const|let|class)\s/.exec(code);
  if (decl) {
    bad.push('a ' + decl[2] + ' declaration on line ' +
             (code.slice(0, decl.index).split('\n').length));
  }

  /* Every byte below 0x20 that is not tab, LF or CR, compared numerically. A character class
     spelling those bytes is a character class that can be corrupted into holding them, which is
     how this rule got broken by the warning about it. */
  for (const [what, text] of [['js', js], ['css', css], ['html', html]]) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        bad.push('a control character, code ' + c + ', in the ' + what + ' at offset ' + i);
        break;
      }
    }
  }

  if (/prefers-color-scheme/.test(css)) bad.push('a prefers-color-scheme query in the css');

  if (bad.length) throw new Error('logtail refuses to emit: it contains ' + bad.join('; '));
}

/**
 * The browser-side helpers, as source text.
 *
 * Shipped verbatim inside js AND exercised directly by this type's tests through new Function, so
 * the code that is tested is textually the code that runs. A Node-shaped twin of a browser
 * function is a twin that eventually disagrees with it, and the disagreement is silent.
 *
 * Function.prototype.toString would give the same guarantee and is the usual way to do this, but
 * it carries the function's comments into the emitted script - so a backtick in a doc comment
 * becomes a template literal in a classic script, and the desk goes blank. A string cannot do
 * that by accident, because the guard reads it.
 *
 * @example
 * const H = new Function(TAIL_SRC + ' return { s: ckSev };')();
 * H.s('connection refused');   // 'err'
 */
export const TAIL_SRC = [
  '  /* A carriage return and a line feed, made from their code points rather than written.',
  '     Both are control characters. Building them arithmetically means no form of this file -',
  '     not the source, not an editor round trip, not a mis-timed decode during emission - can',
  '     end up holding the raw byte, which would be invisible on readback and legal to the',
  '     parser. */',
  '  var CK_LT_CR = String.fromCharCode(13);',
  '  var CK_LT_LF = String.fromCharCode(10);',
  '',
  '  /* The severity vocabulary. Substring rather than whole-word, on purpose: logs say "failed",',
  '     "failure", "warning" and "refused", and a word matcher would find none of them. */',
  '  var CK_LT_BAD  = ["error", "fail", "refused"];',
  '  var CK_LT_WARN = ["warn"];',
  '',
  '  /* The severity of one already-lowercased line: "err", "warn", or the empty string.',
  '     Severity is drawn three ways in the CSS and only one of them is colour. */',
  '  function ckSev(low) {',
  '    var i;',
  '    for (i = 0; i < CK_LT_BAD.length; i++)  if (low.indexOf(CK_LT_BAD[i]) >= 0)  return "err";',
  '    for (i = 0; i < CK_LT_WARN.length; i++) if (low.indexOf(CK_LT_WARN[i]) >= 0) return "warn";',
  '    return "";',
  '  }',
  '',
  '  /* Remove terminal escape sequences, count them, and drop every other C0 byte.',
  '',
  '     The introducer is found by comparing a code point to 27. It is never written into a',
  '     string and never spelled in a character class, because a written escape survives',
  '     node --check, reads back as a space, and can be decoded one step early on the way to',
  '     disk. A number can do none of those things.',
  '',
  '     Tab, line feed and carriage return are kept: they are layout, not noise. The count is',
  '     reported in the caption, because a log that had colour in it and now does not should say',
  '     so rather than look like a log that never had any.',
  '',
  '     Returns the cleaned text, the number of escape sequences removed, and the number of',
  '     stray control bytes removed. */',
  '  function ckAnsiStrip(s) {',
  '    var out = [], ansi = 0, ctrl = 0, i = 0, L = s.length, plain = 0, c, j, k;',
  '    while (i < L) {',
  '      c = s.charCodeAt(i);',
  '      if (c === 27) {',
  '        out.push(s.slice(plain, i));',
  '        ansi = ansi + 1;',
  '        j = i + 1;',
  '        if (j < L) {',
  '          k = s.charCodeAt(j);',
  '          if (k === 91) {',
  '            /* CSI: parameter bytes 0x30..0x3f, intermediates 0x20..0x2f, one final byte. */',
  '            j = j + 1;',
  '            while (j < L) {',
  '              k = s.charCodeAt(j);',
  '              if (k >= 48 && k <= 63) { j = j + 1; continue; }',
  '              if (k >= 32 && k <= 47) { j = j + 1; continue; }',
  '              break;',
  '            }',
  '            if (j < L) j = j + 1;',
  '          } else if (k === 93) {',
  '            /* OSC: runs to a BEL, or to the two bytes that spell a string terminator. A',
  '               window-title sequence in a build log is the common case. */',
  '            j = j + 1;',
  '            while (j < L) {',
  '              k = s.charCodeAt(j);',
  '              if (k === 7) { j = j + 1; break; }',
  '              if (k === 27 && j + 1 < L && s.charCodeAt(j + 1) === 92) { j = j + 2; break; }',
  '              j = j + 1;',
  '            }',
  '          } else if (k >= 32 && k <= 47) {',
  '            /* Intermediates then a final byte: the shape of a charset selection. */',
  '            while (j < L && s.charCodeAt(j) >= 32 && s.charCodeAt(j) <= 47) j = j + 1;',
  '            if (j < L) j = j + 1;',
  '          } else {',
  '            j = j + 1;',
  '          }',
  '        }',
  '        i = j;',
  '        plain = i;',
  '        continue;',
  '      }',
  '      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {',
  '        out.push(s.slice(plain, i));',
  '        ctrl = ctrl + 1;',
  '        i = i + 1;',
  '        plain = i;',
  '        continue;',
  '      }',
  '      i = i + 1;',
  '    }',
  '    out.push(s.slice(plain, L));',
  '    return { text: out.join(""), ansi: ansi, ctrl: ctrl };',
  '  }',
  '',
  '  /* Split a tail response into the lines to display.',
  '',
  '     Exactly one trailing empty element is dropped. A file that ends in a newline is not a',
  '     file with a blank last line, and a phantom row at the bottom of a tail is a row that',
  '     appears and disappears every time the file grows.',
  '',
  '     Where a line holds carriage returns, only what follows the LAST one is shown. That is',
  '     what a terminal displays for a progress line rewriting itself in place, and showing the',
  '     whole accumulation would be showing something nobody ever saw.',
  '',
  '     A trailing carriage return is removed BEFORE that rule is applied, and the order is not',
  '     cosmetic: a file written on Windows ends every line with one, so applying the rule first',
  '     would take what follows the last CR of "a" plus CR, which is nothing at all, and render a',
  '     CRLF log as a column of blank rows. Found exactly that way. */',
  '  function ckSplit(text) {',
  '    var raw = text.split(CK_LT_LF), out = [], i, s, cr;',
  '    if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();',
  '    for (i = 0; i < raw.length; i++) {',
  '      s = raw[i];',
  '      if (s.length > 0 && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, s.length - 1);',
  '      cr = s.lastIndexOf(CK_LT_CR);',
  '      out.push(cr < 0 ? s : s.slice(cr + 1));',
  '    }',
  '    return out;',
  '  }',
  '',
  '  /* True when prev, with its first d lines dropped, is a prefix of next.',
  '',
  '     The final compared line may be a PREFIX of its counterpart rather than equal to it. A file',
  '     whose last line has no newline yet grows in place: the row that read "abc" is now the row',
  '     that reads "abcdef", and treating that as a different file would rebuild the window and',
  '     renumber every row once a second for as long as something is writing to it. */',
  '  function ckSame(prev, next, d) {',
  '    var len = prev.length - d, k;',
  '    if (len > next.length) return false;',
  '    for (k = 0; k < len; k++) {',
  '      if (prev[d + k] === next[k]) continue;',
  '      if (k === len - 1 && next[k].indexOf(prev[d + k]) === 0) continue;',
  '      return false;',
  '    }',
  '    return true;',
  '  }',
  '',
  '  /* How many lines fell off the top between two reads of the same window, or -1 when the two',
  '     reads have nothing in common and the window has to be rebuilt.',
  '',
  '     This is what lets the card keep its DOM: rows leave at the top, rows arrive at the bottom,',
  '     and the two thousand rows in between are never touched. It is also what makes the scroll',
  '     restore exact, because the pixels that left the top are the only ones that moved the',
  '     content under a viewer who was reading it.',
  '',
  '     The search abandons after 64 full comparisons. A log of ten thousand identical lines would',
  '     otherwise make this quadratic every three seconds, and a rebuild is a cheap slightly-wrong',
  '     answer where the alternative is a correct answer that drops frames. */',
  '  function ckDropped(prev, next) {',
  '    var d, tries = 0, one;',
  '    if (prev.length === 0) return 0;',
  '    for (d = 0; d < prev.length; d++) {',
  '      if (prev.length - d > next.length) continue;',
  '      one = prev.length - d === 1;',
  '      if (prev[d] !== next[0] && !(one && next[0].indexOf(prev[d]) === 0)) continue;',
  '      tries = tries + 1;',
  '      if (tries > 64) return -1;',
  '      if (ckSame(prev, next, d)) return d;',
  '    }',
  '    return -1;',
  '  }'
].join('\n');

/**
 * The card's browser half: fetching, rendering and wiring.
 *
 * Written as one string so the whole thing can be wrapped in a function expression. Nothing this
 * card defines should reach the global scope - a desk can hold two logtails, and a top-level var
 * would have them sharing their state and fighting over their scroll positions.
 *
 * @param id   the card's data-card value, embedded as a literal
 * @param path the file to read, embedded as a literal; the empty string means the card was built
 *             without one and must say so rather than ask the server about nothing
 * @param cfg  the per-card setting fallbacks from seed()
 *
 * @example main('build', 'C:/logs/build.log', defaults).indexOf('CK.build') >= 0;   // true
 */
function main(id, path, cfg) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var view    = sec.querySelector(".ck-lt-view");',
    '    var rowsEl  = sec.querySelector(".ck-lt-rows");',
    '    var find    = sec.querySelector(".ck-lt-find");',
    '    var countEl = sec.querySelector(".ck-lt-count");',
    '    var noteEl  = sec.querySelector(".ck-lt-note");',
    '    var liveEl  = sec.querySelector(".ck-lt-live");',
    '    if (!view || !rowsEl) return;',
    '',
    '    var PATH = ' + jsStr(path) + ';',
    '    var TKEY = ' + jsStr('logtail:' + id) + ';',
    '',
    '    /* base is the number carried by the first row still held. It counts UP as rows fall off',
    '       the top, so a window that has been open for an hour shows how far the log has run',
    '       rather than restarting at one every poll. A rebuild resets it, because after a rebuild',
    '       the card genuinely does not know where it is any more. */',
    '    var state = {',
    '      rows: [], lines: [], base: 1, want: ' + Number(cfg.lines) + ', shown: 0,',
    '      q: find ? find.value.trim().toLowerCase() : "",',
    '      ansi: 0, ctrl: 0, nl: true, mode: "wait", note: ""',
    '    };',
    '',
    '    /* The caption is rendered from state rather than written at each call site, so the',
    '       filter changing the count cannot wipe out the note explaining a refusal. */',
    '    function say() {',
    '      var total = state.rows.length, count;',
    '      if (state.mode === "nopath")            count = "no file";',
    '      else if (state.mode === "refused")      count = "unreadable";',
    '      else if (state.mode === "offline")      count = total > 0 ? total + " lines held" : "no data yet";',
    '      else if (state.mode === "wait")         count = "reading";',
    '      else if (total === 0)                   count = "0 lines";',
    '      else if (state.q !== "")                count = "showing " + state.shown + " of " + total + " lines";',
    '      else                                    count = total + (total === 1 ? " line" : " lines");',
    '      if (countEl) countEl.textContent = count;',
    '      if (noteEl)  noteEl.textContent  = state.note;',
    '    }',
    '',
    '    /* Write one line into an existing row. Used for new rows and for the one row that can',
    '       change under us, so there is a single place where a log line becomes a row. */',
    '    function fill(r, text, num) {',
    '      var low = text.toLowerCase(), sev = ckSev(low);',
    '      r.el.className = sev === "" ? "ck-lt-row" : "ck-lt-row sev-" + sev;',
    '      r.n.textContent = String(num);',
    '      r.m.textContent = sev === "err" ? "E" : sev === "warn" ? "W" : "";',
    '      if (sev === "") r.m.removeAttribute("title");',
    '      else r.m.setAttribute("title", sev === "err" ? "error" : "warning");',
    '      /* textContent, never innerHTML. A log line that spells a script tag is a line of text',
    '         ABOUT a script tag, and the only way to keep it that way is to never parse it. The',
    '         desk renders text it did not write; this is where that promise is kept. */',
    '      r.x.textContent = text;',
    '      r.hay = low;',
    '    }',
    '',
    '    /* A row is five nodes and no listeners. Two thousand rows with a listener each is two',
    '       thousand registrations to make and tear down on every rebuild; the card needs none, so',
    '       it has none. */',
    '    function makeRow(text, num) {',
    '      var el = document.createElement("div");',
    '      var g  = document.createElement("span");',
    '      var n  = document.createElement("span");',
    '      var m  = document.createElement("span");',
    '      var x  = document.createElement("span");',
    '      g.className = "ck-lt-g"; n.className = "ck-lt-n";',
    '      m.className = "ck-lt-m"; x.className = "ck-lt-x";',
    '      g.appendChild(n); g.appendChild(m);',
    '      el.appendChild(g); el.appendChild(x);',
    '      var r = { el: el, n: n, m: m, x: x, hay: "" };',
    '      fill(r, text, num);',
    '      return r;',
    '    }',
    '',
    '    /* Hiding rather than removing, so following and filtering do not have to know about each',
    '       other: a poll appends rows and this decides which of them are visible. The haystack is',
    '       the lowercased line, computed once when the row was made. */',
    '    function applyFilter() {',
    '      var q = state.q, i, r, hide, shown = 0;',
    '      for (i = 0; i < state.rows.length; i++) {',
    '        r = state.rows[i];',
    '        hide = q !== "" && r.hay.indexOf(q) < 0;',
    '        if (r.el.hidden !== hide) r.el.hidden = hide;',
    '        if (!hide) shown = shown + 1;',
    '      }',
    '      state.shown = shown;',
    '    }',
    '',
    '    function render(next) {',
    '      /* THE SCROLL RULE. This is the whole ergonomics of the card and it is four lines.',
    '',
    '         Measured BEFORE the DOM changes and restored after. A viewer sitting at the bottom is',
    '         FOLLOWING, so the view goes back to the bottom and new lines appear under the old',
    '         ones - that is what a tail is for. A viewer who has scrolled up is READING, and',
    '         dragging them to the end every three seconds makes the card useless for the single',
    '         thing anybody opens a log to do. So their pixel offset is put back exactly, less the',
    '         height of whatever fell off the top of the window, which is the only thing that',
    '         legitimately moved the content underneath them.',
    '',
    '         The four pixels of slack are not superstition: a fractional scrollHeight and a',
    '         device-pixel-rounded scrollTop rarely add up to exactly zero, and a viewer who IS at',
    '         the bottom must not be read as scrolled away because the numbers missed by half a',
    '         pixel and then never follow again. */',
    '      var pinned = view.scrollHeight - view.scrollTop - view.clientHeight <= 4;',
    '      var top = view.scrollTop;',
    '      var lost = 0, i, k;',
    '',
    '      var d = ckDropped(state.lines, next);',
    '      if (d < 0) {',
    '        /* Nothing in common: the file was rotated, truncated or replaced. Rebuild, and admit',
    '           it by restarting the numbering rather than pretending the count carried over. */',
    '        while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);',
    '        state.rows = []; state.lines = []; state.base = 1; d = 0;',
    '      } else if (d > 0) {',
    '        for (i = 0; i < d; i++) {',
    '          lost = lost + state.rows[i].el.offsetHeight;',
    '          rowsEl.removeChild(state.rows[i].el);',
    '        }',
    '        state.rows = state.rows.slice(d);',
    '        state.base = state.base + d;',
    '      }',
    '',
    '      var keep = state.lines.length - d;',
    '      /* The last kept row is rewritten rather than trusted: a final line with no newline',
    '         grows in place, so the row that was "abc" is the row that is now "abcdef" and',
    '         nothing else in this function would notice. */',
    '      if (keep > 0) fill(state.rows[keep - 1], next[keep - 1], state.base + keep - 1);',
    '',
    '      var frag = document.createDocumentFragment();',
    '      for (k = keep; k < next.length; k++) {',
    '        var r = makeRow(next[k], state.base + k);',
    '        state.rows.push(r);',
    '        frag.appendChild(r.el);',
    '      }',
    '      /* One insertion for the whole batch. Two thousand appendChild calls against a live tree',
    '         is two thousand chances to relayout, and a poll that stutters is a poll the viewer',
    '         feels every three seconds. */',
    '      rowsEl.appendChild(frag);',
    '      state.lines = next;',
    '',
    '      applyFilter();',
    '      if (pinned) view.scrollTop = view.scrollHeight;',
    '      else view.scrollTop = top - lost;',
    '    }',
    '',
    '    function accept(body) {',
    '      var strip = ckAnsiStrip(body);',
    '      state.ansi = strip.ansi;',
    '      state.ctrl = strip.ctrl;',
    '      /* Code point 10 rather than a written newline. Comparing numerically is the one form',
    '         of this test that cannot be corrupted into holding the byte it is looking for. */',
    '      state.nl = body.length === 0 || body.charCodeAt(body.length - 1) === 10;',
    '      render(ckSplit(strip.text));',
    '      state.mode = "ok";',
    '      var bits = [];',
    '      if (state.rows.length === 0) bits.push("the file is empty");',
    '      if (state.ansi > 0) bits.push(state.ansi + (state.ansi === 1 ? " ansi escape stripped" : " ansi escapes stripped"));',
    '      if (state.ctrl > 0) bits.push(state.ctrl + (state.ctrl === 1 ? " control byte removed" : " control bytes removed"));',
    '      if (!state.nl) bits.push("last line has no trailing newline");',
    '      state.note = bits.join(" \\u00b7 ");',
    '      sec.classList.remove("ck-lt-bad");',
    '      say();',
    '    }',
    '',
    '    function refuse(status, body) {',
    '      /* The server explains itself in the body and its words go into the caption unchanged.',
    '         "The desk is not allowed to read that", "no such file" and "the file is empty" are',
    '         three different facts, and a generic failure message makes them one - which sends',
    '         the reader hunting for a bug in the file when the answer was in the response all',
    '         along. Nothing is rewritten here, not even the wording. */',
    '      state.mode = "refused";',
    '      state.note = body === "" ? "HTTP " + status : body;',
    '      sec.classList.add("ck-lt-bad");',
    '      say();',
    '    }',
    '',
    '    function offline() {',
    '      /* Whatever was read last stays on screen. A log that blanks itself because the server',
    '         was restarted has thrown away the only copy of what it was showing, and the timer',
    '         is still running, so the next poll will simply succeed. */',
    '      state.mode = "offline";',
    '      state.note = "the desk is not answering \\u00b7 still trying";',
    '      sec.classList.add("ck-lt-bad");',
    '      say();',
    '    }',
    '',
    '    function poll() {',
    '      if (PATH === "") { state.mode = "nopath"; state.note = "this card was built without a path"; say(); return; }',
    '      /* Plain fetch, not CK.net: /tail is the desk\'s own server on the same origin, and',
    '         CK.net is the proxy for reaching somewhere else. The response is text, not JSON.',
    '',
    '         The rejection handler is the SECOND argument to then rather than a catch on the end,',
    '         so a bug thrown inside accept cannot be reported to the viewer as the server being',
    '         down. Those two failures need different words and different actions. */',
    '      fetch("/tail?f=" + encodeURIComponent(PATH) + "&n=" + state.want, { cache: "no-store" })',
    '        .then(function (r) {',
    '          var ok = r.ok, status = r.status;',
    '          return r.text().then(function (body) { return { ok: ok, status: status, body: body }; });',
    '        })',
    '        .then(function (res) { if (res.ok) accept(res.body); else refuse(res.status, res.body); },',
    '              function () { offline(); });',
    '    }',
    '',
    '    if (find) CK.once(find, "find", function () {',
    '      find.addEventListener("input", function () {',
    '        /* Filtering never touches the timer or the fetched window: it decides which of the',
    '           rows already here are visible. Following a filtered log keeps working, and it',
    '           keeps working on the rows that arrive next. */',
    '        state.q = find.value.trim().toLowerCase();',
    '        applyFilter();',
    '        say();',
    '      });',
    '    });',
    '',
    '    var was = null;',
    '    CK.settings(sec, ' + JSON.stringify(cfg) + ', function (c) {',
    '      /* A select hands back a string. Every numeric setting is coerced here rather than',
    '         trusted, because "2000" + 1 is "20001" and that is a query string asking the server',
    '         for twenty thousand lines. Stored values are re-vetted for the same reason: local',
    '         storage is a text file the viewer can edit. */',
    '      var want = Number(c.lines);',
    '      if (!isFinite(want) || want <= 0) want = ' + Number(defaults.lines) + ';',
    '      var secs = Number(c.interval);',
    '      if (!isFinite(secs) || secs <= 0) secs = ' + Number(defaults.interval) + ';',
    '      var follow = !!c.follow;',
    '',
    '      sec.classList.toggle("ck-lt-wrap", !!c.wrap);',
    '      sec.classList.toggle("ck-lt-on", follow);',
    '      if (liveEl) liveEl.textContent = follow ? "following" : "paused";',
    '      state.want = want;',
    '',
    '      /* Wrapping is a paint. Re-reading the file because somebody ticked a checkbox about',
    '         line breaking would be a fetch nobody asked for, so only the settings that change',
    '         what is fetched, or how often, restart the timer. */',
    '      var moved = was === null || was.want !== want || was.secs !== secs || was.follow !== follow;',
    '      was = { want: want, secs: secs, follow: follow };',
    '      if (!moved) { say(); return; }',
    '      if (PATH === "") { state.mode = "nopath"; state.note = "this card was built without a path"; say(); return; }',
    '',
    '      /* CK.timer, never a bare setInterval. The desk swaps its main element and replays every',
    '         builder, and CK.once cannot guard this: once keys off the ELEMENT, and a swap hands',
    '         the builder a brand new one with an empty dataset, so the guard passes and a second',
    '         interval starts while the first keeps polling at a detached tree. CK.timer keys off a',
    '         name in a registry that outlives the DOM, so this replaces rather than stacks.',
    '',
    '         With following switched off the same call is made and stopped immediately: CK.timer',
    '         runs its work once before it schedules anything, so that reads the file exactly once',
    '         and leaves no interval behind - including any interval a previous run started. */',
    '      var stop = CK.timer(TKEY, secs * 1000, poll);',
    '      if (!follow) stop();',
    '    });',
    '  });'
  ].join('\n');
}

/**
 * One option element for a select, marked selected when it is the fallback in force.
 *
 * The selected attribute matters even though CK.settings assigns the value on open: the panel is
 * markup first, and markup that says nothing about which option is chosen shows the first one to
 * anybody whose script has not run yet.
 *
 * @param value the option's value and, unless a label is given, its text
 * @param label what the reader sees
 * @param on    whether this option is the current fallback
 *
 * @example opt(500, '500 lines', true);   // '<option value="500" selected>500 lines</option>'
 */
function opt(value, label, on) {
  return '<option value="' + esc(value) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>';
}

/**
 * Build one logtail card.
 *
 * @param id    the card's directory name; becomes its data-card attribute
 * @param title the card's heading, rendered as plain text
 * @param data  { path, lines, filter, follow, wrap }; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns { json, html, css, js }
 *
 * @throws {Error} when the emitted script would break the deck - see guardEmitted
 *
 * @example
 * build({ id: 'build', title: 'build log', ord: 30,
 *         data: { path: 'C:/tmp/build.log', lines: 500, filter: 'error' } })
 *   .html.indexOf('data-card="build"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d    = data && typeof data === 'object' ? data : {};
  const path = d.path == null ? '' : String(d.path);
  const pre  = d.filter == null ? '' : String(d.filter);
  const cfg  = seed(d);

  const lineOpts = LINE_CHOICES.map((n) => opt(n, n + ' lines', n === cfg.lines)).join('');
  const pollOpts = POLL_CHOICES.map((n) => opt(n, 'every ' + n + 's', n === cfg.interval)).join('');

  const html =
    '<section data-card="' + esc(id) + '" class="ck-logtail">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-lines">lines</label>\n' +
    '    <select id="' + esc(id) + '-lines" name="lines">' + lineOpts + '</select>\n' +
    '    <label for="' + esc(id) + '-interval">poll</label>\n' +
    '    <select id="' + esc(id) + '-interval" name="interval">' + pollOpts + '</select>\n' +
    '    <label for="' + esc(id) + '-follow">follow</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-follow" name="follow">\n' +
    '    <label for="' + esc(id) + '-wrap">wrap long lines</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-wrap" name="wrap">\n' +
    '    <div class="ck-set-foot">following keeps the view at the end only while it is already there. ' +
    'scroll up to read something and it stays where you put it.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-lt-tools">\n' +
    '    <input type="search" class="ck-lt-find" placeholder="filter lines" aria-label="filter lines" ' +
    'autocomplete="off" spellcheck="false" value="' + esc(pre) + '">\n' +
    '    <span class="ck-lt-live"></span>\n' +
    '  </div>\n' +
    '  <div class="ck-lt-view" tabindex="0" aria-label="file tail">\n' +
    '    <div class="ck-lt-rows"></div>\n' +
    '  </div>\n' +
    '  <div class="ck-cap"><b class="ck-lt-count">reading</b><i class="ck-lt-note"></i>' +
    '<span class="ck-aside ck-lt-path">' + esc(path) + '</span></div>\n' +
    '</section>\n';

  const js = '(function () {\n' + TAIL_SRC + '\n\n' + main(id, path, cfg) + '\n})();\n';

  const out = { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
  guardEmitted(out);
  return out;
}

/* Every colour in here is a desk token, so the theme switch is the only thing that has to know
   anything and nothing keys off prefers-color-scheme. The desk is one document open in two
   viewers who want different answers, and the OS only knows how to give both the same one.

   Joined from an array rather than written as a template literal, so this file contains no
   backtick at all - see the note at the top about what one stray backtick does to a deck whose
   scripts share a single inline block. */
const CSS = [
  '  .ck-logtail { position: relative; }',
  '',
  '  /* A checkbox inherits the settings panel\'s full-width input rule and comes out as a',
  '     stretched box; it wants to be its own size, at the start of its column. */',
  '  .ck-logtail .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }',
  '',
  '  /* the tool row */',
  '',
  '  .ck-logtail .ck-lt-tools { display: flex; align-items: center; gap: 8px; margin: 10px 0 7px; }',
  '  .ck-logtail .ck-lt-find {',
  '    flex: 1 1 auto; min-width: 0;',
  '    font: inherit; font-family: var(--mono); font-size: 11px;',
  '    box-sizing: border-box; padding: 5px 8px;',
  '    background: var(--well); color: var(--ink);',
  '    border: 1px solid var(--hairline); border-radius: 5px;',
  '  }',
  '  .ck-logtail .ck-lt-find:focus { outline: none; border-color: var(--accent); }',
  '  .ck-logtail .ck-lt-find::placeholder { color: var(--ink-faint); }',
  '',
  '  /* Following or paused, said in words. A dot that changes colour says it to some readers',
  '     and to nobody else. */',
  '  .ck-logtail .ck-lt-live {',
  '    flex: none; font-family: var(--mono); font-size: 9.5px;',
  '    letter-spacing: .07em; text-transform: uppercase; color: var(--ink-faint);',
  '  }',
  '  .ck-logtail.ck-lt-on .ck-lt-live { color: var(--good); }',
  '',
  '  /* the window */',
  '',
  '  /* Both axes belong to this box and to nothing outside it. A ten-thousand-character line',
  '     makes a row very wide; the row is inside this scroller, so the card keeps its width and',
  '     the desk column never moves sideways. */',
  '  .ck-logtail .ck-lt-view {',
  '    max-width: 100%; max-height: 46vh; min-height: 96px;',
  '    overflow: auto; overscroll-behavior: contain;',
  '    background: var(--well); border: 1px solid var(--hairline); border-radius: 6px;',
  '    padding: 4px 0;',
  '  }',
  '  .ck-logtail .ck-lt-view:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }',
  '',
  '  /* max-content so one long line sets the scroll width; min-width 100% so a highlighted row',
  '     still reaches the right edge when every line is short. */',
  '  .ck-logtail .ck-lt-rows { width: max-content; min-width: 100%; }',
  '  .ck-logtail.ck-lt-wrap .ck-lt-rows { width: auto; }',
  '',
  '  .ck-logtail .ck-lt-row {',
  '    display: flex; align-items: flex-start;',
  '    font-family: var(--mono); font-size: 11px; line-height: 1.55;',
  '    background: var(--well);',
  '  }',
  '  /* [hidden] and display:flex tie on specificity and this sheet loads after the browser\'s,',
  '     so a filtered-out row would stay visible without ever saying so. */',
  '  .ck-logtail .ck-lt-row[hidden] { display: none; }',
  '',
  '  /* The gutter never joins a copy: select the window, paste the log, and the line numbers and',
  '     severity markers are not in what you pasted. It also sticks to the left edge, so it stays',
  '     readable while a very long line is scrolled sideways. */',
  '  .ck-logtail .ck-lt-g {',
  '    flex: none; position: sticky; left: 0; z-index: 1;',
  '    display: flex; align-items: baseline; gap: 4px; padding: 0 8px 0 4px;',
  '    background: inherit; border-left: 2px solid transparent;',
  '    user-select: none; -webkit-user-select: none;',
  '  }',
  '  .ck-logtail .ck-lt-n {',
  '    min-width: 4ch; text-align: right;',
  '    color: var(--ink-faint); font-variant-numeric: tabular-nums;',
  '  }',
  '  .ck-logtail .ck-lt-m { min-width: 1ch; text-align: center; font-weight: 700; color: var(--ink-faint); }',
  '',
  '  .ck-logtail .ck-lt-x { flex: 1 1 auto; white-space: pre; color: var(--ink); padding-right: 10px; }',
  '  .ck-logtail.ck-lt-wrap .ck-lt-x { white-space: pre-wrap; overflow-wrap: anywhere; }',
  '',
  '  /* Severity is carried three ways and only one of them is colour: the letter in the gutter,',
  '     the rule down the left edge, and the weight of the line. A reader who cannot tell coral',
  '     from amber still reads E against W. */',
  '  .ck-logtail .ck-lt-row.sev-err { background: var(--pill); }',
  '  .ck-logtail .ck-lt-row.sev-err .ck-lt-g { border-left-color: var(--ck-s1); }',
  '  .ck-logtail .ck-lt-row.sev-err .ck-lt-m { color: var(--ck-s1); }',
  '  .ck-logtail .ck-lt-row.sev-err .ck-lt-x { font-weight: 700; }',
  '  .ck-logtail .ck-lt-row.sev-warn { background: var(--pill); }',
  '  .ck-logtail .ck-lt-row.sev-warn .ck-lt-g { border-left-color: var(--ck-s2); }',
  '  .ck-logtail .ck-lt-row.sev-warn .ck-lt-m { color: var(--ck-s2); }',
  '',
  '  /* the caption */',
  '',
  '  /* pre-line because the server explains a refusal across two lines and the second one is the',
  '     list of roots, which is the useful half. */',
  '  .ck-logtail .ck-lt-note {',
  '    display: block; white-space: pre-line; font-style: normal; color: var(--ink-dim);',
  '  }',
  '  .ck-logtail.ck-lt-bad .ck-lt-note { color: var(--ck-s1); }',
  '  .ck-logtail .ck-lt-path {',
  '    display: block; font-family: var(--mono); font-size: 10px;',
  '    overflow-wrap: anywhere; color: var(--ink-faint);',
  '  }'
].join('\n');
