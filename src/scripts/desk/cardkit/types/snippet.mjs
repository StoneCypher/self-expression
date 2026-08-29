/**
 * The 'snippet' card type — a command and what it produced.
 *
 * Not a terminal. A record. Nothing here is interactive except a copy button and the settings,
 * because the thing being shown already happened: there is no cursor, no input, no colour, and
 * no pretence that running it again would produce this. A terminal emulator on a desk card
 * would be a toy; a legible record of one run is a tool.
 *
 * Four decisions worth defending before reading the code:
 *
 *   1. **ANSI is stripped, in Node, and counted.** Terminal colour is a control language, and
 *      rendering it would mean parsing SGR state machines into spans and then having a card
 *      whose palette is the program's rather than the desk's - which breaks in one of the two
 *      themes by construction, since a program picking "bright white" has no idea it is being
 *      read on paper-coloured ground. So the sequences come out. They are counted on the way
 *      out and the caption says how many, because silently discarding part of what a program
 *      wrote is the sort of edit that should be admitted.
 *   2. **The escape introducer is never written, only compared.** {@link ESC} is a number. A
 *      literal control character is invisible when written, rendered as a space on readback,
 *      legal to the parser, and survives a syntax check; and an escape sequence for one can be
 *      decoded a step too early during emission and land on disk as the raw byte. Neither can
 *      happen to a numeric comparison, because a numeric comparison does not contain the
 *      character in any form.
 *   3. **A truncation that does not say it truncated is a lie.** The fold is a visible element
 *      carrying the count of what it hides and the line numbers on both sides of it, AND the
 *      caption repeats the count. Without the script nothing is folded at all, so the no-script
 *      rendering cannot be a quiet lie either.
 *   4. **Absent is not zero and zero is not success.** No output recorded, output recorded as
 *      empty, and output that was nothing but escape sequences are three different sentences.
 *      A missing exit status reads "not recorded" and carries neither the shape nor the word of
 *      a success.
 *
 * @see meta for the accepted shape
 * @see sanitize for the cleaning pipeline and the order its stages have to run in
 */

/* ── control characters, by number only ──────────────────────────────────────────────────── */

/**
 * The escape introducer, ESCAPE, as a number.
 *
 * Written as a number and compared as a number, never typed, never quoted, never spelled as a
 * string escape. That is the whole mechanism: the character does not appear in this file in any
 * form, so it cannot be mistyped into invisibility and it cannot be produced by an escape that
 * something decoded one step too early.
 */
const ESC = 0x1B;

/** BELL, which by long convention also terminates an operating-system-command string. */
const BEL = 0x07;

/** The 8-bit form of the control-sequence introducer, for output that arrived pre-decoded. */
const CSI8 = 0x9B;

/** LINE FEED and CARRIAGE RETURN, the two the line splitter cares about. */
const LF = 0x0A, CR = 0x0D;

/** TAB, which is kept: a tab in program output is usually a column, not an accident. */
const TAB = 0x09;

/** DELETE, the one control character that is not below the C0 range. */
const DEL = 0x7F;

/** The bytes an escape sequence can be built from, as ranges rather than as characters. */
const PARAM_LO = 0x30, PARAM_HI = 0x3F;   /* parameter bytes, 0 through question mark */
const INTER_LO = 0x20, INTER_HI = 0x2F;   /* intermediate bytes, space through slash   */
const FINAL_LO = 0x40, FINAL_HI = 0x7E;   /* final bytes, at-sign through tilde        */

/** The characters that introduce each family of escape, as numbers. */
const OPEN_CSI = 0x5B;   /* left square bracket: a control sequence            */
const OPEN_OSC = 0x5D;   /* right square bracket: an operating-system command  */
const OPEN_DCS = 0x50;   /* P: a device control string                         */
const OPEN_SOS = 0x58;   /* X: a start-of-string                               */
const OPEN_PM  = 0x5E;   /* caret: a privacy message                           */
const OPEN_APC = 0x5F;   /* underscore: an application program command         */
const CLOSE_ST = 0x5C;   /* backslash: the second half of a string terminator  */

/** The surrogate ranges, for repairing text that was cut mid-character. */
const HI_LO = 0xD800, HI_HI = 0xDBFF, LO_LO = 0xDC00, LO_HI = 0xDFFF;

/** U+FFFD, built rather than typed, for the same reason as everything else in this block. */
const REPLACEMENT = String.fromCharCode(0xFFFD);

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * These three keys and the 'name' attributes in the card's settings panel are one thing seen
 * twice, and the verifier checks it in both directions: a field whose name has drifted is
 * ignored by CK.settings - correctly, and silently - and looks exactly like a control that does
 * nothing.
 *
 * 'wrap' is off because program output is column-aligned far more often than it is prose, and
 * wrapping destroys the alignment that made it worth keeping; the block scrolls sideways inside
 * itself instead, so nothing widens the desk either way. 'lines' is 200 rather than 0 because a
 * desk card is a glance and two hundred lines is already more than one - and unlike a silent
 * cap, this one announces itself twice.
 *
 * Declared before {@link meta} so meta.defaults can be spread from it: the contract wants the
 * settings reachable from meta, and a separate export is nicer to read, so there is one written
 * source and two places to read it.
 *
 * @example defaults.lines;   // 200
 */
export const defaults = { wrap: false, lines: 200, showCwd: true };

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * 'shape' is a string and 'defaults' is an object, per the contract: the first is read by a
 * person choosing a type and has to scan at a glance, the second is read by a machine checking
 * a panel's fields against it.
 *
 * @example meta.name;                    // 'snippet'
 * @example Object.keys(meta.defaults);   // ['wrap', 'lines', 'showCwd']
 */
export const meta = {
  name: 'snippet',
  summary: 'One command, where it ran, what it printed and how it ended, with terminal escape ' +
           'sequences stripped and any folding stated out loud.',
  shape: '{ command, cwd, output, exit, ranAt, shell } — output is the raw text including any ' +
         'ANSI sequences, which are removed and counted; exit is a number, and anything else ' +
         'reads as not recorded rather than as success',
  defaults: { ...defaults },
};

/* ── cleaning ────────────────────────────────────────────────────────────────────────────── */

/**
 * The index just past the escape sequence starting at 'i'.
 *
 * Every test in here is a numeric comparison against a named constant, so no control character
 * and no escape for one appears anywhere in the function. The families are the ones a real
 * program emits: control sequences for colour and cursor motion, string commands for window
 * titles and hyperlinks, the two-character escapes for charset and keypad modes.
 *
 * A sequence that runs off the end of the string consumes the rest of it. That is the right
 * answer for truncated output: half an escape sequence is not text, and printing its tail would
 * put the letters of a colour code into the record.
 *
 * @param s the text being scanned
 * @param i the index of the introducer, already known to be one
 * @returns the index of the first character that is not part of the sequence
 *
 * @example skipEscape(String.fromCharCode(0x1B) + '[31m' + 'x', 0);   // 5
 */
function skipEscape(s, i) {
  const len = s.length;
  const code = (k) => (k >= 0 && k < len ? s.charCodeAt(k) : -1);

  let intro, j;
  if (code(i) === CSI8) { intro = OPEN_CSI; j = i + 1; }
  else { intro = code(i + 1); j = i + 2; }

  if (intro === OPEN_CSI) {
    while (j < len && code(j) >= PARAM_LO && code(j) <= PARAM_HI) j += 1;
    while (j < len && code(j) >= INTER_LO && code(j) <= INTER_HI) j += 1;
    if (j < len && code(j) >= FINAL_LO && code(j) <= FINAL_HI) j += 1;
    return j;
  }

  if (intro === OPEN_OSC || intro === OPEN_DCS || intro === OPEN_SOS ||
      intro === OPEN_PM  || intro === OPEN_APC) {
    while (j < len) {
      if (code(j) === BEL) return j + 1;
      if (code(j) === ESC && code(j + 1) === CLOSE_ST) return j + 2;
      j += 1;
    }
    return len;
  }

  if (intro >= INTER_LO && intro <= INTER_HI) {
    while (j < len && code(j) >= INTER_LO && code(j) <= INTER_HI) j += 1;
    if (j < len && code(j) >= PARAM_LO && code(j) <= FINAL_HI) j += 1;
    return j;
  }

  if (intro >= PARAM_LO && intro <= FINAL_HI) return i + 2;

  /* An introducer with nothing usable after it. It still goes: a lone escape is not text. */
  return i + 1;
}

/**
 * Text with every terminal escape sequence removed, and a count of how many there were.
 *
 * The count is the point of returning an object. Removing colour from a program's output is an
 * edit, and an edit made silently is indistinguishable from output that never had colour in it.
 * The caption says the number so a reader who wonders why a normally-colourful command looks
 * plain has an answer on the card.
 *
 * @param s the raw text
 * @returns '{ text, count }'
 *
 * @example stripAnsi(String.fromCharCode(0x1B) + '[1mhi' + String.fromCharCode(0x1B) + '[0m');
 * // { text: 'hi', count: 2 }
 */
function stripAnsi(s) {
  let out = '', count = 0, i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === ESC || c === CSI8) {
      i = skipEscape(s, i);
      count += 1;
      continue;
    }
    out += s.charAt(i);
    i += 1;
  }
  return { text: out, count };
}

/**
 * One newline convention: every CRLF and every lone CR becomes a bare LF.
 *
 * A lone carriage return is how a program draws a progress bar, by returning to the start of the
 * line and writing over it. There is no overwriting in a record, so each return becomes a line
 * of its own and the record shows every frame the program drew. That is more honest than picking
 * the last one, which would silently discard the intermediate output, and it is stated here
 * because a reader who sees forty near-identical percentage lines deserves to know it was a
 * progress bar rather than a loop bug.
 *
 * @param s text that may hold either convention
 *
 * @example unifyNewlines('a' + String.fromCharCode(13) + 'b').length;   // 3
 */
function unifyNewlines(s) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) !== CR) { out += s.charAt(i); continue; }
    if (s.charCodeAt(i + 1) === LF) continue;      // the LF that follows stands for the pair
    out += String.fromCharCode(LF);
  }
  return out;
}

/**
 * Text with C0 control characters and DEL removed, keeping tab and newline, and a count.
 *
 * Written as code-point arithmetic rather than as a character class on purpose, per the
 * contract's sixth rule. A class has to be spelled with escapes, and an escape decoded one step
 * too early puts a raw control character into the file, where it is invisible in every editor,
 * legal to the parser, and survives a syntax check. Comparing numbers cannot go wrong that way.
 *
 * Tab stays because a tab in program output is usually a column. Newline stays because it is
 * what the record is divided by.
 *
 * @param s text that has already had its escape sequences removed
 * @returns '{ text, count }'
 *
 * @example stripControls('a' + String.fromCharCode(0) + 'b');   // { text: 'ab', count: 1 }
 */
function stripControls(s) {
  let out = '', count = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === TAB || c === LF) { out += s.charAt(i); continue; }
    if (c < 32 || c === DEL) { count += 1; continue; }
    out += s.charAt(i);
  }
  return { text: out, count };
}

/**
 * Text with every unpaired surrogate replaced, and a count of them.
 *
 * Output captured from a process is bytes, and a capture that stopped mid-character - or a
 * program writing something that was never UTF-8 in the first place - arrives as a string
 * holding surrogate code units with no partner. Those are not valid in a document: they cannot
 * be serialised, and depending on the path they take they either throw or become mojibake far
 * from here. Replacing them puts the damage where it happened and counts it, so the caption can
 * say the output was not clean text rather than leaving the reader to wonder about the diamonds.
 *
 * Well-formed pairs are copied through untouched, both halves together.
 *
 * @param s text to repair
 * @returns '{ text, count }'
 *
 * @example mendSurrogates('a' + String.fromCharCode(0xD800)).count;   // 1
 */
function mendSurrogates(s) {
  let out = '', count = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= HI_LO && c <= HI_HI) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (d >= LO_LO && d <= LO_HI) { out += s.charAt(i) + s.charAt(i + 1); i += 1; continue; }
      out += REPLACEMENT; count += 1; continue;
    }
    if (c >= LO_LO && c <= LO_HI) { out += REPLACEMENT; count += 1; continue; }
    out += s.charAt(i);
  }
  return { text: out, count };
}

/**
 * The whole cleaning pipeline, with a tally of everything it took out.
 *
 * The order of the three stages is load-bearing and is the reason this is one function rather
 * than three calls at the call site:
 *
 *   1. escape sequences first, because they are BUILT from control characters - the introducer
 *      is one and the terminator of a string command is another. Stripping controls first would
 *      shred every sequence into its printable letters, and the record would fill up with the
 *      text "[31m" where the colour used to be.
 *   2. newlines next, so the line splitter downstream has one convention to know about.
 *   3. surrogates last, over text that is otherwise final, so the count means "damage that
 *      survived cleaning" rather than "damage, some of which was about to be removed anyway".
 *
 * @param v anything; null and undefined become the empty string
 * @returns '{ text, ansi, ctrl, lone }' - the cleaned text and the three counts
 *
 * @example sanitize('plain');   // { text: 'plain', ansi: 0, ctrl: 0, lone: 0 }
 */
function sanitize(v) {
  const a = stripAnsi(String(v == null ? '' : v));
  const b = stripControls(unifyNewlines(a.text));
  const c = mendSurrogates(b.text);
  return { text: c.text, ansi: a.count, ctrl: b.count, lone: c.count };
}

/**
 * The cleaned output split into lines.
 *
 * A single trailing newline is a terminator rather than an empty last line, so it does not
 * produce one - otherwise every well-behaved program's output would show a phantom blank line
 * at the bottom and the line count would be one too high.
 *
 * @param text cleaned output text
 *
 * @example splitLines('a\nb\n').length;   // 2
 * @example splitLines('').length;         // 0
 */
function splitLines(text) {
  if (text === '') return [];
  const parts = text.split(String.fromCharCode(LF));
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/* ── the exit status ─────────────────────────────────────────────────────────────────────── */

/**
 * The exit status as a number, or a flag saying it was not recorded.
 *
 * Booleans are refused deliberately. A caller passing 'true' for "it worked" would otherwise be
 * read as exit 1, which is failure - the exact inversion, silently. Anything that is not a
 * finite number and not a numeric string reads as not recorded, which the card then renders with
 * its own shape and its own word so it can never be mistaken for a zero.
 *
 * @param v the caller's 'exit'
 * @returns '{ known, code, odd }' - odd marks a value that was present but unusable, which the
 *   caption reports separately from a value that was simply absent
 *
 * @example exitOf(0);        // { known: true, code: 0, odd: false }
 * @example exitOf('137');    // { known: true, code: 137, odd: false }
 * @example exitOf(true);     // { known: false, code: 0, odd: true }
 */
function exitOf(v) {
  if (v === null || v === undefined || v === '') return { known: false, code: 0, odd: false };
  if (typeof v === 'number') {
    return Number.isFinite(v)
      ? { known: true, code: v, odd: false }
      : { known: false, code: 0, odd: true };
  }
  if (typeof v === 'string') {
    const t = v.trim();
    const n = Number(t);
    if (t !== '' && Number.isFinite(n)) return { known: true, code: n, odd: false };
  }
  return { known: false, code: 0, odd: true };
}

/**
 * When the command ran, as text.
 *
 * A parseable timestamp is normalised to ISO with a Z, because a record's timestamp exists to be
 * compared with other records and a local rendering makes that comparison a puzzle. Anything
 * unparseable is shown as the caller wrote it, cleaned and clipped to its first line - the
 * caller may have had a good reason to write "just now", and inventing a date would be worse
 * than passing one through.
 *
 * @param v the caller's 'ranAt'
 *
 * @example whenText(0);              // '1970-01-01T00:00:00Z'
 * @example whenText('after lunch');  // 'after lunch'
 */
function whenText(v) {
  if (v == null || v === '') return '';
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  if (Number.isFinite(t)) {
    try { return new Date(t).toISOString().slice(0, 19) + 'Z'; } catch (e) { return ''; }
  }
  const first = splitLines(sanitize(v).text)[0];
  return first === undefined ? '' : first;
}

/* ── escaping and embedding ──────────────────────────────────────────────────────────────── */

/**
 * HTML-escape a value, mirroring CK.esc byte for byte.
 *
 * Duplicated rather than imported because kit.js is a classic script and not a module. The two
 * must agree exactly: a card whose Node side and browser side disagree about what is safe is a
 * card with a hole in whichever side is more permissive.
 *
 * This is the only thing standing between a command that contains a closing script tag and a
 * card that ends the desk's markup early, so it is worth saying that it escapes the angle
 * brackets rather than looking for that particular string.
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
 * JSON.stringify alone is not enough for text that lands inside a script element: a closing
 * angle sequence would end it, and U+2028/U+2029 are line terminators to a JS parser but not to
 * JSON. The backtick and the query mark are escaped for a different reason - this type's
 * verifier asserts the emitted script contains no template literals and no optional chaining,
 * and a card id containing a backtick would fail that check with a mystifying message about a
 * rule it did not break. Cheaper to make the data unable to spell the forbidden tokens at all.
 *
 * @param s the text to embed
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return embed(String(s == null ? '' : s));
}

/**
 * The backtick, built from its code point rather than typed.
 *
 * Every other mention of the character in this file goes through this constant, so the only two
 * literal backticks in the module are the pair delimiting the CSS below. That is a checkable
 * property - the verifier counts them and expects two - and it is worth having because a stray
 * backtick is how a template literal opens by accident, which is the exact fault that has blanked
 * this desk more than once.
 *
 * @example TICK.charCodeAt(0);   // 96
 */
const TICK = String.fromCharCode(96);

/**
 * A JSON literal for any value, safe to paste into the emitted classic script.
 *
 * The same escaping as {@link jsStr}, applied to a whole structure. Every replaced character
 * only ever occurs inside a JSON string, so rewriting it as an escape sequence changes the
 * spelling of the literal and not its value.
 *
 * @param v anything JSON can carry
 *
 * @example embed({ a: '<b>' });   // '{"a":"\\u003cb\\u003e"}'
 */
function embed(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .split(TICK).join('\\u0060')
    .replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A copy of some JavaScript with every comment body and string body replaced by spaces.
 *
 * Length is preserved character for character, so an offset found in the blanked copy is the
 * same offset in the original and an error can still point at a real line.
 *
 * This exists because a keyword scan that reads prose cries wolf, and a guard that cries wolf is
 * a guard that gets deleted. A card was refused tonight because one of its own comments said
 * "the class is what CSS reads" - a true sentence, in a comment, about CSS, which the build
 * called an ES6 class. Keyword bans are therefore checked against code only.
 *
 * The scan is a single left-to-right pass, which is what makes it correct on the two cases that
 * trip up regex-based versions: an apostrophe inside a comment does not open a string, and a
 * comment marker inside a string does not open a comment. Regular-expression literals are not
 * recognised, which is safe here because the emitted scripts contain none; a slash is left as
 * itself, and a slash is neither a quote nor a keyword.
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
 * Throw unless a piece of emitted browser source is a classic script.
 *
 * Every card's script is concatenated into one inline block, so one modern-syntax parse error
 * blanks EVERY card on the desk, not just this one. That has happened repeatedly, and the
 * commonest cause is not a deliberate arrow function - it is a backtick inside a comment, which
 * looks like prose and parses as the start of a template literal. A build that emits one should
 * fail loudly here rather than quietly at the reader's browser, where the only symptom is an
 * empty desk.
 *
 * The two halves of the check are deliberately different, because the two kinds of token are
 * deliberately different:
 *
 *   - a backtick, an arrow and an optional chain are scanned RAW, over the whole text including
 *     comments and strings. None of them can appear innocently: the backtick is the exact bug
 *     this guard was written for, and it does its damage from inside a comment.
 *   - 'const', 'let' and 'class' are scanned over {@link blankOut}'s copy, which is code only.
 *     All three are ordinary English words, and refusing a build because a comment used one is
 *     how a guard earns a reputation for being wrong and gets deleted.
 *
 * @param src  the emitted script text
 * @param what a label for the error message, naming which piece failed
 * @returns the source unchanged, so this can wrap an expression
 * @throws {Error} naming the token found and the line it was found on
 *
 * Exported so a verifier can prove the guard fires, and prove it does NOT fire on prose - the
 * same argument that has table.mjs exporting its comparator source. A guard that is only ever
 * exercised by not throwing has never been tested at all.
 *
 * @example assertClassic('var a = 1;  // let it be\n', 'js').length > 0;   // true
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

  /* A control character, compared numerically rather than matched against a class. It is legal
     JavaScript inside a string, so nothing downstream will complain: it survives a syntax check,
     it is invisible in an editor, and it lands in the page as a byte nobody can see or grep for.
     This card handles more raw process output than any other type on the desk, so it is the one
     most likely to carry one through by accident. Tab, newline and carriage return stay. */
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) {
      found.push(['a control character, code point ' + c, i]);
      break;
    }
  }

  if (found.length === 0) return src;
  found.sort((a, b) => a[1] - b[1]);
  const at = found[0][1];
  const line = src.slice(0, at).split('\n').length;
  throw new Error('snippet: emitted ' + what + ' contains ' + found[0][0] + ' at line ' + line +
                  ': ' + JSON.stringify(src.slice(Math.max(0, at - 40), at + 40)));
}

/* ── drawn furniture ─────────────────────────────────────────────────────────────────────── */

/**
 * One drawn glyph, with the stroke defaults the rest of the desk uses.
 *
 * Drawn rather than typed: a check mark emoji is a font lottery at 11px and lands as a black
 * box, a coloured square or a completely different shape depending on the machine, and this
 * particular glyph is carrying the difference between success and failure.
 *
 * @param d the path data
 *
 * @example draw('<path d="M0 0"/>').indexOf('<svg') === 0;   // true
 */
function draw(d) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

/**
 * The three exit-status glyphs.
 *
 * Three distinct shapes, so the status is legible in greyscale, to a colour-blind reader, and
 * out of the corner of an eye: a check for zero, a cross for anything else, a barred ring for
 * a status that was never recorded. The word beside each says the same thing again.
 *
 * @example Object.keys(EXIT_GLYPH);   // ['ok', 'bad', 'unknown']
 */
const EXIT_GLYPH = {
  ok:      draw('<path d="M5 12.6l4.6 4.6L19 7.2"/>'),
  bad:     draw('<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>'),
  unknown: draw('<circle cx="12" cy="12" r="7.4"/><path d="M8.4 12h7.2"/>'),
};

/** The copy glyph: two offset sheets, the shape every clipboard control on the desk uses. */
const COPY_GLYPH = draw('<rect x="9" y="9" width="11" height="11" rx="2"/>' +
                        '<path d="M15 5.5H6a1.5 1.5 0 00-1.5 1.5v9"/>');

/* ── the browser half ────────────────────────────────────────────────────────────────────── */

/**
 * The card's browser half: folding, copying and one class toggle. Never rendering.
 *
 * Every line of output is already in the markup, written once in Node, escaped once. The script
 * only hides lines and moves one marker, so there is exactly one place where data becomes markup
 * and exactly one escape to get right - and the card still says everything it knows, unfolded,
 * if the script never runs. An unfolded record is honest; a folded one that could not draw its
 * own fold would not be.
 *
 * Written as one string wrapped in a function expression, so nothing this card defines reaches
 * the global scope - a desk can hold two snippets, and a top-level declaration would have them
 * sharing it. Classic script throughout, checked by {@link assertClassic} before it leaves the
 * build.
 *
 * @param id     the card's data-card value, embedded as a literal
 * @param preCls the class the output block carries before the wrap setting is applied
 *
 * @example main('build', 'ck-sn-pre').indexOf('CK.build') >= 0;   // true
 */
function main(id, preCls) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var pre     = sec.querySelector(".ck-sn-pre");',
    '    var cut     = sec.querySelector(".ck-sn-cut");',
    '    var cmdEl   = sec.querySelector(".ck-sn-cmd");',
    '    var copyBtn = sec.querySelector(".ck-sn-copy");',
    '    var copyLab = sec.querySelector(".ck-sn-copy-t");',
    '    var cwdEl   = sec.querySelector(".ck-sn-cwd");',
    '    var countEl = sec.querySelector(".ck-sn-count");',
    '    var PRE_CLS = ' + jsStr(preCls) + ';',
    '',
    '    var LINES = [], i;',
    '    if (pre) {',
    '      for (i = 0; i < pre.children.length; i++) {',
    '        if (pre.children[i].className.indexOf("ck-sn-l") >= 0) LINES.push(pre.children[i]);',
    '      }',
    '    }',
    '',
    '    /* The fold. Head and tail rather than a head alone, because the end of a command run',
    '       is where the failure usually is and a cap that kept only the beginning would hide',
    '       exactly the part somebody opened the card to read.',
    '',
    '       Whatever it hides, it says: the marker carries the number of folded lines and the',
    '       line numbers on both sides of the fold, and the caption carries the count again. A',
    '       truncation that does not announce itself is a lie about what the command printed,',
    '       and this card is a record. */',
    '    function fold(cap) {',
    '      var n = LINES.length, k, head, tail, hidden, tailFrom, says;',
    '      if (!countEl && !pre) return;',
    '',
    '      if (cap <= 0 || n <= cap) {',
    '        for (k = 0; k < n; k++) LINES[k].hidden = false;',
    '        if (cut) cut.hidden = true;',
    '        if (countEl) countEl.textContent = n + (n === 1 ? " line" : " lines");',
    '        return;',
    '      }',
    '',
    '      head = Math.ceil(cap / 2);',
    '      tail = cap - head;',
    '      tailFrom = n - tail;',
    '      hidden = n - cap;',
    '      for (k = 0; k < n; k++) LINES[k].hidden = k >= head && k < tailFrom;',
    '',
    '      if (cut) {',
    '        says = "\\u2026 " + hidden + (hidden === 1 ? " line" : " lines") +',
    '               " folded away \\u2014 showing 1\\u2013" + head;',
    '        if (tail > 0) says = says + " and " + (tailFrom + 1) + "\\u2013" + n;',
    '        cut.textContent = says + " \\u2026";',
    '        cut.hidden = false;',
    '        /* The marker belongs between the two halves, so it has to move when the cap does.',
    '           Moving the one element rather than minting a new one keeps it a single node no',
    '           matter how many times the setting is changed. */',
    '        pre.insertBefore(cut, LINES[head]);',
    '      }',
    '      if (countEl) {',
    '        countEl.textContent = "showing " + cap + " of " + n + " lines \\u2014 " + hidden +',
    '                              " folded away in the middle";',
    '      }',
    '    }',
    '',
    '    /* Copying is offered for the command and not for the output, which is deliberate: the',
    '       command is the thing anyone wants to run again, and the output has already been',
    '       edited by this card - escape sequences removed, control characters dropped - so',
    '       handing it over as if it were what the program wrote would be a small forgery. */',
    '    if (copyBtn && cmdEl) CK.once(copyBtn, "copy", function () {',
    '      copyBtn.addEventListener("click", function () {',
    '        var text = cmdEl.textContent;',
    '',
    '        function said(m) {',
    '          if (!copyLab) return;',
    '          copyLab.textContent = m;',
    '          setTimeout(function () { copyLab.textContent = "copy"; }, 1400);',
    '        }',
    '',
    '        /* Selecting the text is the fallback rather than a silent failure. A copy button',
    '           that does nothing is worse than no copy button: the reader walks away believing',
    '           the command is on the clipboard. */',
    '        function pick() {',
    '          try {',
    '            var r = document.createRange(), s = window.getSelection();',
    '            r.selectNodeContents(cmdEl);',
    '            s.removeAllRanges();',
    '            s.addRange(r);',
    '            said("selected \\u2014 copy it");',
    '          } catch (no) { said("copy failed"); }',
    '        }',
    '',
    '        if (navigator.clipboard && navigator.clipboard.writeText) {',
    '          navigator.clipboard.writeText(text).then(function () { said("copied"); }, pick);',
    '        } else pick();',
    '      });',
    '    });',
    '',
    '    CK.settings(sec, ' + embed(defaults) + ', function (cfg) {',
    '      var cap = Math.floor(Number(cfg.lines));',
    '      if (!isFinite(cap) || cap < 0) cap = 0;',
    '      if (pre) pre.className = PRE_CLS + (cfg.wrap ? " ck-sn-wrap" : "");',
    '      if (cwdEl) cwdEl.hidden = !cfg.showCwd;',
    '      fold(cap);',
    '    });',
    '  });'
  ].join('\n');
}

/* ── the build ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build one snippet card.
 *
 * @param id    the card's directory name; becomes its data-card attribute
 * @param title the card's heading, rendered as plain text
 * @param data  '{ command, cwd, output, exit, ranAt, shell }'; every value in it is untrusted,
 *   cleaned and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns '{ json, html, css, js }'
 * @throws {Error} when the emitted script is not a classic script, which would blank the whole
 *   desk rather than only this card
 *
 * @example
 * build({ id: 'build', title: 'npm run build', ord: 1, data: {
 *   command: 'npm run build', cwd: '/srv/app', output: 'ok\n', exit: 0, shell: 'bash'
 * } }).html.indexOf('exit 0') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};

  const cmd = sanitize(d.command);
  const hasOutput = d.output !== null && d.output !== undefined;
  const raw = hasOutput ? String(d.output) : '';
  const out = sanitize(raw);
  const lines = splitLines(out.text);

  const code = exitOf(d.exit);
  const kind = code.known ? (code.code === 0 ? 'ok' : 'bad') : 'unknown';
  const word = code.known ? 'exit ' + String(code.code) : 'exit not recorded';

  const cwd = sanitize(d.cwd).text.split(String.fromCharCode(LF))[0] || '';
  const shell = sanitize(d.shell).text.split(String.fromCharCode(LF))[0] || '';
  const when = whenText(d.ranAt);

  /* Three different empties, and they say three different things. The card does not know that
     "nothing was recorded" and "the command printed nothing" are the same situation, because
     they are not: one is a gap in the record and the other is a fact about the command. */
  const emptyWhy = !hasOutput ? 'no output was recorded'
    : raw === '' ? 'the command produced no output'
    : 'the output held nothing but escape and control characters';

  const meta_ = [];
  if (shell !== '') meta_.push('<span class="ck-sn-shell">' + esc(shell) + '</span>');
  if (cwd !== '') meta_.push('<span class="ck-sn-cwd">' + esc(cwd) + '</span>');
  if (when !== '') meta_.push('<span class="ck-sn-when">' + esc(when) + '</span>');

  /* No whitespace between the children of the pre: inside a pre element, the newline and the
     indentation between two tags are content, and they would each draw a blank line. */
  const preCls = 'ck-sn-pre' + (lines.length > 1 ? ' ck-sn-num' : '');
  const body = lines.length === 0
    ? '<div class="ck-sn-void">' + esc(emptyWhy) + '</div>'
    : '<div class="ck-scroll ck-sn-out"><pre class="' + preCls + '">' +
      lines.map((t, k) =>
        '<span class="ck-sn-l" data-n="' + (k + 1) + '">' + esc(t) + '</span>').join('') +
      '<span class="ck-sn-cut" hidden></span></pre></div>';

  const blank = lines.length > 0 && out.text.trim() === '';

  const notes = [];
  if (out.ansi + cmd.ansi > 0) {
    const n = out.ansi + cmd.ansi;
    notes.push(n + (n === 1 ? ' escape sequence removed' : ' escape sequences removed'));
  }
  if (out.ctrl + cmd.ctrl > 0) {
    const n = out.ctrl + cmd.ctrl;
    notes.push(n + (n === 1 ? ' control character removed' : ' control characters removed'));
  }
  if (out.lone + cmd.lone > 0) {
    const n = out.lone + cmd.lone;
    notes.push(n + (n === 1 ? ' unpaired code unit replaced' : ' unpaired code units replaced'));
  }
  if (blank) notes.push('the output is whitespace only');
  if (code.odd) notes.push('the exit status was not a number, so it reads as not recorded');

  const html =
    '<section data-card="' + esc(id) + '" class="ck-snippet">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-wrap">wrap long lines</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-wrap" name="wrap">\n' +
    '    <label for="' + esc(id) + '-lines">line cap</label>\n' +
    '    <input type="number" id="' + esc(id) + '-lines" name="lines" min="0" max="100000" step="10">\n' +
    '    <label for="' + esc(id) + '-showCwd">show the directory</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-showCwd" name="showCwd">\n' +
    '    <div class="ck-set-foot">a cap of 0 shows every line. above the cap the middle is ' +
    'folded away, and the fold says how many lines it took.</div>\n' +
    '  </div>\n' +
    '  <div class="ck-sn-head">\n' +
    '    <span class="ck-sn-exit ck-sn-e-' + kind + '">' + EXIT_GLYPH[kind] +
    '<b>' + esc(word) + '</b></span>\n' +
    (meta_.length ? '    <span class="ck-sn-meta">' + meta_.join('') + '</span>\n' : '') +
    '  </div>\n' +
    '  <div class="ck-sn-cmdbox">\n' +
    '    <code class="ck-sn-cmd">' + esc(cmd.text) + '</code>\n' +
    '    <button type="button" class="ck-sn-copy" title="copy the command" ' +
    'aria-label="copy the command">' + COPY_GLYPH +
    '<span class="ck-sn-copy-t" aria-live="polite">copy</span></button>\n' +
    '  </div>\n' +
    '  ' + body + '\n' +
    '  <div class="ck-cap">' +
    (d.caption == null ? '' : esc(sanitize(d.caption).text) + ' ') +
    '<i class="ck-sn-count">' +
    (lines.length === 0 ? '' : esc(lines.length + (lines.length === 1 ? ' line' : ' lines'))) +
    '</i>' +
    (notes.length ? ' <span class="ck-aside">' + esc(notes.join(' \u00b7 ')) + '</span>' : '') +
    '</div>\n' +
    '</section>\n';

  const js = assertClassic('(function () {\n' + main(id, preCls) + '\n})();\n', 'js');

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off prefers-color-scheme. The
   desk is one document open in two viewers who want different answers, and the OS only knows
   how to give both of them the same one. */
const CSS = `
  .ck-snippet { position: relative; }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box;
     it wants to be its own size, at the start of its column. */
  .ck-snippet .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  /* ── the status line ────────────────────────────────────────────────────────────────── */

  .ck-snippet .ck-sn-head {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 6px 12px; margin: 10px 0 7px;
  }

  /* The glyph carries the status as a shape and the word carries it as language; colour is the
     third signal and never the only one. A reader in greyscale, a reader who is colour-blind
     and a reader glancing from a metre away all get the same answer. */
  .ck-snippet .ck-sn-exit {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums;
    padding: 2px 8px 2px 6px; border-radius: 5px;
    border: 1px solid var(--pill-edge); background: var(--pill);
  }
  .ck-snippet .ck-sn-exit svg { width: 13px; height: 13px; display: block; flex: none; }
  .ck-snippet .ck-sn-exit b { font-weight: 400; }
  .ck-snippet .ck-sn-e-ok  { color: var(--good); }
  .ck-snippet .ck-sn-e-bad { color: var(--ck-s1); border-color: var(--ck-s1); }
  /* Not recorded is faint and dashed: it must not read as a quiet success, and a dashed edge
     is the one border that says "incomplete" without needing a colour. */
  .ck-snippet .ck-sn-e-unknown { color: var(--ink-faint); border-style: dashed; }

  .ck-snippet .ck-sn-meta {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px;
    font-family: var(--mono); font-size: 10px; color: var(--ink-faint); min-width: 0;
  }
  .ck-snippet .ck-sn-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30ch; }
  .ck-snippet .ck-sn-cwd[hidden] { display: none; }

  /* ── the command ────────────────────────────────────────────────────────────────────── */

  .ck-snippet .ck-sn-cmdbox {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 8px 8px 8px 10px; border-radius: 6px;
    background: var(--well); border: 1px solid var(--hairline);
  }

  /* pre-wrap rather than pre: a multi-line command keeps its line breaks, and a long one wraps
     rather than pushing a scrollbar onto the thing a reader is most likely to want to read. */
  .ck-snippet .ck-sn-cmd {
    flex: 1 1 auto; min-width: 0;
    font-family: var(--mono); font-size: 11.5px; line-height: 1.55; color: var(--ink);
    white-space: pre-wrap; overflow-wrap: anywhere;
  }

  .ck-snippet .ck-sn-copy {
    flex: none; display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 7px; border-radius: 4px; cursor: pointer;
    background: transparent; color: var(--ink-faint);
    border: 1px solid var(--pill-edge);
    font-family: var(--mono); font-size: 10px;
  }
  .ck-snippet .ck-sn-copy svg { width: 12px; height: 12px; display: block; }
  .ck-snippet .ck-sn-copy:hover { color: var(--accent); border-color: var(--accent); }
  .ck-snippet .ck-sn-copy:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

  /* ── the output ─────────────────────────────────────────────────────────────────────── */

  /* The block owns both axes: a wide line scrolls sideways inside it and a long run scrolls
     down inside it, so neither ever moves the desk column or grows the card without limit. */
  .ck-snippet .ck-sn-out { margin-top: 8px; max-height: 46vh; overflow-y: auto; }

  .ck-snippet .ck-sn-pre {
    margin: 0; font-family: var(--mono); font-size: 11px; line-height: 1.5; color: var(--ink-dim);
  }

  /* A hanging indent, so a wrapped line lines up under the text rather than under its number. */
  .ck-snippet .ck-sn-l { display: block; min-height: 1.5em; white-space: pre; }
  .ck-snippet .ck-sn-l[hidden] { display: none; }
  .ck-snippet .ck-sn-wrap .ck-sn-l { white-space: pre-wrap; overflow-wrap: anywhere; }
  .ck-snippet .ck-sn-num .ck-sn-l { padding-left: 4.4em; text-indent: -4.4em; }

  /* The number comes from an attribute rather than a CSS counter on purpose: a counter skips
     the lines the fold hides, so every line after a fold would be renumbered and the record
     would claim line 61 was line 51. */
  .ck-snippet .ck-sn-num .ck-sn-l::before {
    content: attr(data-n);
    display: inline-block; width: 3.5em; padding-right: .9em; text-indent: 0;
    text-align: right; color: var(--ink-faint); font-variant-numeric: tabular-nums;
  }

  /* The fold announces itself: ruled above and below so it cannot be mistaken for output, and
     carrying the count of what it hides. */
  .ck-snippet .ck-sn-cut {
    display: block; margin: 6px 0; padding: 5px 0;
    border-top: 1px dashed var(--rule); border-bottom: 1px dashed var(--rule);
    color: var(--ck-s2); font-size: 10.5px; text-align: center; white-space: normal;
  }
  .ck-snippet .ck-sn-cut[hidden] { display: none; }

  .ck-snippet .ck-sn-void {
    margin-top: 8px; padding: 14px 4px; text-align: center;
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }

  .ck-snippet .ck-sn-count { font-style: normal; color: var(--ink-faint); }
`;
