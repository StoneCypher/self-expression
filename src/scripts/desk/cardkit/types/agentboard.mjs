/**
 * The 'agentboard' card type — what has been dispatched, what came back, and how long each
 * agent has been out.
 *
 * This card exists because background work you cannot see is not backgrounded, it is hidden.
 * Five agents out for four minutes and one out for forty is a completely different situation
 * from six out for four minutes, and nothing in a transcript tells you which one you are in.
 * So the board leads with what is still running, sorted by who has been out longest, and it
 * says the elapsed time out loud rather than the start time — nobody subtracts timestamps in
 * their head while waiting.
 *
 * Four decisions worth defending before reading the code:
 *
 *   1. **The board never implies it is live unless it is.** This is the failure this card must
 *      not have. A board fed from a URL that has stopped answering looks exactly like a board
 *      that is answering, and the reader draws conclusions from durations that stopped moving
 *      an hour ago. So provenance is a first-class piece of the card: the caption always names
 *      where the rows came from, and every failure mode of the live source has its own sentence.
 *      A 404 falls back to the static list AND says, in the caption, that it is a static list
 *      because no live source answered.
 *   2. **Elapsed is recomputed from 'started', never accumulated.** A counter that adds one
 *      second per tick drifts whenever a tab is throttled, backgrounded or asleep, and it drifts
 *      *downwards* — so the board understates how long an agent has been out, which is the exact
 *      direction that makes it useless. Every repaint subtracts a fresh clock reading from the
 *      recorded start.
 *   3. **One ordering and one duration rule, written once.** {@link CORE_SRC} is a text that
 *      Node runs through 'new Function' to draw the no-script markup and that is also shipped
 *      inside the card script to run again over whatever the live source returns. A Node-shaped
 *      twin of it would drift, and the drift would appear as a static half and a live half that
 *      disagree about who has been out longest.
 *   4. **Failure is marked, not merely coloured.** A failed row carries a cross glyph, the word
 *      'failed', and a left rule. Colour is the fourth signal, not the only one.
 *
 * @see meta for the accepted shape
 * @see CORE_SRC for the ordering, the duration rule and the normaliser
 */

/* ── the shared core ─────────────────────────────────────────────────────────────────────── */

/**
 * The ordering, the duration arithmetic and the normaliser, as browser source.
 *
 * This string is shipped verbatim inside the emitted script AND evaluated here in Node through
 * 'new Function', so the rules that draw the static markup are textually the rules that run in
 * the browser over live data. The contract asks for exactly this: a second Node-side copy of
 * "the same" logic is a copy that drifts, and here the drift would be invisible — two halves of
 * one board quietly disagreeing about who has been out longest.
 *
 * Classic script throughout: 'var' and 'function' only, index loops rather than iterators, and
 * numeric code-point comparisons rather than character classes.
 *
 * @example
 * const core = new Function(CORE_SRC + ' return ckRank;')();
 * core('running');   // 0
 */
export const CORE_SRC = [
  '  /* The four states this card understands, in the order the board groups them.',
  '     Running leads because it is the only group whose numbers are still moving, and it is',
  '     the group the reader opened the card for. Queued follows: not out yet, but promised.',
  '     Failed comes before done because a failure is a thing to act on and a success is a',
  '     thing to have. A state this card does not know ranks last and is grouped as "other" -',
  '     it renders as the caller spelled it rather than being dropped, because the row is the',
  '     reader\'s and the vocabulary is ours. */',
  '  function ckRank(state) {',
  '    if (state === "running") return 0;',
  '    if (state === "queued")  return 1;',
  '    if (state === "failed")  return 2;',
  '    if (state === "done")    return 3;',
  '    return 4;',
  '  }',
  '',
  '  /* The heading a state files under. Every unknown state shares one bucket rather than',
  '     minting a heading each, so a source with a typo in it cannot shatter the board into',
  '     one-row groups. */',
  '  function ckGroup(state) {',
  '    return ckRank(state) === 4 ? "other" : state;',
  '  }',
  '',
  '  /* Strip C0 control characters and DEL from caller text.',
  '     Written as code-point arithmetic rather than as a character class on purpose: a class',
  '     has to be spelled with escapes, and an escape decoded one step too early puts a raw',
  '     control character into the file, where it is invisible in every editor, legal to the',
  '     parser, and survives a syntax check. Comparing numbers cannot go wrong that way.',
  '     Iterating by code unit is safe for astral characters: both halves of a surrogate pair',
  '     are far above 32, so a pair is copied through intact. */',
  '  function ckClean(v) {',
  '    var s = v === null || v === undefined ? "" : String(v);',
  '    var out = "", i, c;',
  '    for (i = 0; i < s.length; i++) {',
  '      c = s.charCodeAt(i);',
  '      if (c < 32 || c === 127) continue;',
  '      out += s.charAt(i);',
  '    }',
  '    return out;',
  '  }',
  '',
  '  /* Epoch milliseconds for a timestamp, or null when it cannot be read as one.',
  '     A number is taken as epoch milliseconds; text goes through Date.parse, which means ISO',
  '     strings are exact and everything else is at the engine\'s mercy. That is stated rather',
  '     than hidden: feed ISO. Null rather than a guess, because a guessed start time produces',
  '     a confident wrong duration, which is worse than an admitted missing one. */',
  '  function ckTime(v) {',
  '    if (v === null || v === undefined || v === "") return null;',
  '    if (typeof v === "number") return isFinite(v) ? v : null;',
  '    if (typeof v === "boolean") return null;',
  '    var t = Date.parse(String(v));',
  '    return isFinite(t) ? t : null;',
  '  }',
  '',
  '  /* The agent list, deduped and settled to strings and numbers.',
  '     Returns null - not an empty array - when the value is not a board at all, so a live',
  '     source answering with a stray object can be reported as "that was not a list of agents"',
  '     rather than silently emptying the board, which would read as "everything finished".',
  '     Duplicate ids are dropped rather than renamed: the id is how anything outside this card',
  '     names a row, and two rows sharing one make every such reference ambiguous. A row with',
  '     no id gets a synthetic one instead, because failing to name itself does not make a',
  '     dispatched agent less real. Bookkeeping keys are prefixed so that an agent called',
  '     "constructor" cannot collide with an inherited property of the plain object. */',
  '  function ckNormalize(raw) {',
  '    var list = raw;',
  '    if (list && !Array.isArray(list) && Array.isArray(list.agents)) list = list.agents;',
  '    if (!Array.isArray(list)) return null;',
  '    var out = [], seen = {}, i, a, id, nm, st, auto = 0;',
  '    for (i = 0; i < list.length; i++) {',
  '      a = list[i];',
  '      if (!a || typeof a !== "object") continue;',
  '      id = ckClean(a.id);',
  '      if (id === "") { do { id = "a" + auto; auto = auto + 1; } while (seen["k" + id] === 1); }',
  '      if (seen["k" + id] === 1) continue;',
  '      seen["k" + id] = 1;',
  '      nm = ckClean(a.name);',
  '      st = ckClean(a.state).toLowerCase();',
  '      out.push({',
  '        i: out.length,',
  '        id: id,',
  '        name: nm === "" ? id : nm,',
  '        task: ckClean(a.task),',
  '        note: ckClean(a.note),',
  '        state: st,',
  '        known: ckRank(st) < 4,',
  '        started: ckTime(a.started),',
  '        finished: ckTime(a.finished)',
  '      });',
  '    }',
  '    return out;',
  '  }',
  '',
  '  /* A duration in the largest two units that still carry information.',
  '     An agent out for over a day is a real case and reads "2d 7h" rather than "191340s".',
  '     A negative or unreadable span returns the empty string; every caller of this checks',
  '     for that case first and says something specific instead, because a duration that came',
  '     out blank is a fact about the data and deserves its own words. */',
  '  function ckDur(ms) {',
  '    var s = Math.floor(ms / 1000);',
  '    if (!isFinite(s) || s < 0) return "";',
  '    var d = Math.floor(s / 86400);',
  '    var h = Math.floor((s % 86400) / 3600);',
  '    var m = Math.floor((s % 3600) / 60);',
  '    var r = s % 60;',
  '    if (d > 0) return d + "d " + h + "h";',
  '    if (h > 0) return h + "h " + m + "m";',
  '    if (m > 0) return m + "m " + r + "s";',
  '    return r + "s";',
  '  }',
  '',
  '  /* What the duration column says for one agent, and why.',
  '     The "why" becomes a title attribute and the "bad" flag becomes a visible mark plus a',
  '     line in the caption, so every one of these cases is admitted on screen rather than',
  '     rendered as a plausible-looking number.',
  '',
  '     The cases, in the order they are tested:',
  '       - a queued agent with no start has simply not started; that is normal, not a defect,',
  '         and it gets an em dash rather than an alarm.',
  '       - a finish earlier than its start is reported, never rendered as a negative duration:',
  '         a minus sign in this column would read as a clock skew the viewer has to diagnose.',
  '       - no start at all means no duration can be computed for anyone.',
  '       - a finished agent with no finish time is NOT given a running clock. Counting up for',
  '         something that has already come back is precisely the lie this card exists to avoid.',
  '     Everything left is the ordinary case: now minus started while out, finished minus',
  '     started once back. */',
  '  function ckSpan(a, now) {',
  '    if (a.state === "queued" && a.started === null) {',
  '      return { text: "\\u2014", why: "not started yet", bad: false };',
  '    }',
  '    if (a.started === null) {',
  '      return { text: "n/r", why: "no start time was recorded", bad: true };',
  '    }',
  '    if (a.finished !== null && a.finished < a.started) {',
  '      return { text: "n/a", why: "the finish time is earlier than the start time", bad: true };',
  '    }',
  '    var out = a.state === "running" || a.state === "queued";',
  '    if (!out && a.finished === null) {',
  '      return { text: "n/r", why: "no finish time was recorded", bad: true };',
  '    }',
  '    var ms = (out ? now : a.finished) - a.started;',
  '    if (!isFinite(ms) || ms < 0) {',
  '      return { text: "n/a", why: "the recorded times do not make a duration", bad: true };',
  '    }',
  '    return { text: ckDur(ms), why: "", bad: false };',
  '  }',
  '',
  '  /* The board order: by group, then by the thing the reader of that group wants first.',
  '     Running sorts by start ascending, so the agent that has been out longest is at the top -',
  '     it is the one you are most likely wondering about. Failed and done sort by finish',
  '     descending, newest result first, because a result you have already seen is history.',
  '     Queued keeps source order, which is dispatch order and therefore the order they will go.',
  '     Every branch falls back to the source index, so the comparator is a total order and the',
  '     result does not depend on the engine\'s sort algorithm. */',
  '  function ckOrder(list) {',
  '    var out = list.slice(0);',
  '    out.sort(function (a, b) {',
  '      var ra = ckRank(a.state), rb = ckRank(b.state);',
  '      if (ra !== rb) return ra - rb;',
  '      if (ra === 0) {',
  '        if (a.started === null && b.started === null) return a.i - b.i;',
  '        if (a.started === null) return 1;',
  '        if (b.started === null) return -1;',
  '        if (a.started !== b.started) return a.started - b.started;',
  '        return a.i - b.i;',
  '      }',
  '      if (ra === 2 || ra === 3) {',
  '        if (a.finished === null && b.finished === null) return a.i - b.i;',
  '        if (a.finished === null) return 1;',
  '        if (b.finished === null) return -1;',
  '        if (a.finished !== b.finished) return b.finished - a.finished;',
  '        return a.i - b.i;',
  '      }',
  '      return a.i - b.i;',
  '    });',
  '    return out;',
  '  }'
].join('\n');

/**
 * The same core, callable here in Node.
 *
 * Built from {@link CORE_SRC} rather than written twice, which is the whole point of that
 * string existing.
 *
 * @example CORE.dur(90000);   // '1m 30s'
 */
const CORE = new Function(
  CORE_SRC +
  '\n  return { rank: ckRank, group: ckGroup, clean: ckClean, time: ckTime,' +
  ' norm: ckNormalize, dur: ckDur, span: ckSpan, order: ckOrder };'
)();

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * How often the card asks the live source for a new list, in milliseconds.
 *
 * Not a setting. A poll interval is a property of the source, not of the viewer, and exposing
 * it invites someone to set it to 250ms on a board with two hundred rows. Five seconds is short
 * enough that a finished agent is noticed while you are still looking at the card and long
 * enough that a desk left open all day is not a load generator.
 */
const POLL_MS = 5000;

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * These three keys and the 'name' attributes in the card's settings panel are one thing seen
 * twice, and the verifier checks it in both directions: a field whose name has drifted is
 * ignored by CK.settings - correctly, and silently - and looks exactly like a control that does
 * nothing.
 *
 * 'poll' defaults on because a board that has to be switched on to be current is a board that
 * will be read while off. 'show' defaults to all because hiding finished agents by default
 * would make the card lie by omission about what came back.
 *
 * Declared before {@link meta} so meta.defaults can be spread from it: the contract wants the
 * settings reachable from meta, and a separate export is nicer to read, so there is one written
 * source and two places to read it.
 *
 * @example defaults.show;   // 'all'
 */
export const defaults = { poll: true, show: 'all', dense: false };

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * 'shape' is a string and 'defaults' is an object, per the contract: the first is read by a
 * person choosing a type and has to scan at a glance, the second is read by a machine checking
 * a panel's fields against it.
 *
 * @example meta.name;                    // 'agentboard'
 * @example Object.keys(meta.defaults);   // ['poll', 'show', 'dense']
 */
export const meta = {
  name: 'agentboard',
  summary: 'Dispatched agents grouped by state, running first, with a live elapsed time for ' +
           'each and an honest account of where the list came from.',
  shape: '{ url, agents: [{ id, name, task, state, started, finished, note }], now } — ' +
         'state is queued | running | done | failed; started and finished are ISO strings or ' +
         'epoch milliseconds; url is a same-origin path polled for a fresher list and defaults ' +
         'to /agents.json, and url: false turns the live source off',
  defaults: { ...defaults },
};

/**
 * The states that have their own drawn glyph, and the bucket everything else falls into.
 *
 * Each state is told apart by a shape and a word before colour is involved at all: a ring for
 * queued, a ring with a hand for running, a cross for failed, a check for done, a ring with a
 * query mark for anything this card does not recognise. Colour-blind readers, greyscale prints
 * and a desk in high contrast all keep the distinction.
 *
 * @example GLYPHS.failed.indexOf('<svg') === 0;   // true
 */
const GLYPHS = (() => {
  const draw = (d) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  return {
    running: draw('<circle cx="12" cy="12" r="7.2"/><path d="M12 7.9V12l2.7 1.9"/>'),
    queued:  draw('<circle cx="12" cy="12" r="7.2"/>'),
    failed:  draw('<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>'),
    done:    draw('<path d="M5 12.6l4.6 4.6L19 7.2"/>'),
    other:   draw('<circle cx="12" cy="12" r="7.2"/><path d="M12 16.4v.01"/>' +
                  '<path d="M9.7 10.1a2.3 2.3 0 014.6 0c0 1.6-2.3 1.9-2.3 3.4"/>'),
  };
})();

/* ── escaping and embedding ──────────────────────────────────────────────────────────────── */

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
 * This exists because a keyword scan that reads prose cries wolf, and a guard that cries wolf
 * is a guard that gets deleted. Another card was refused tonight because one of its own
 * comments said "the class is what CSS reads" - a true sentence, in a comment, about CSS, and
 * the build called it an ES6 class. Keyword bans are therefore checked against code only.
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
     Tab, newline and carriage return are the source's own punctuation and stay. */
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
  throw new Error('agentboard: emitted ' + what + ' contains ' + found[0][0] + ' at line ' + line +
                  ': ' + JSON.stringify(src.slice(Math.max(0, at - 40), at + 40)));
}

/* ── the live source ─────────────────────────────────────────────────────────────────────── */

/**
 * The URL the card polls, and a sentence explaining the answer when there is none.
 *
 * Only a same-origin path is accepted, and it is accepted by *shape* rather than by rejecting
 * known-bad spellings: it must begin with one slash and not two, so a protocol-relative URL -
 * which looks like a path and is not one - fails along with every absolute scheme. The card
 * uses plain fetch rather than the desk's proxy, so a cross-origin URL here would either be
 * blocked by the page's connect-src or, worse, quietly work and send the desk's cookies
 * somewhere the desk did not choose.
 *
 * 'false' is the explicit way to say "no live source"; absent, null and empty all mean "use the
 * default", because a caller who omitted the field almost always wants the desk's usual feed.
 *
 * @param v the caller's 'url'
 * @returns '{ url, note }' - the url is '' when there is no live source, and the note is the
 *   clause the caption uses to say why
 *
 * @example live('/x.json').url;   // '/x.json'
 * @example live(false).note;      // 'no live source configured'
 * @example live('//evil.example/x').url;   // ''
 */
function live(v) {
  if (v === false) return { url: '', note: 'no live source configured' };
  if (v === null || v === undefined || v === '') return { url: '/agents.json', note: '' };
  const s = CORE.clean(v).trim();
  if (s.charAt(0) !== '/' || s.charAt(1) === '/') {
    return { url: '', note: 'the configured source is not a same-origin path, so it was refused' };
  }
  return { url: s, note: '' };
}

/* ── the static half ─────────────────────────────────────────────────────────────────────── */

/**
 * One agent's row, as markup.
 *
 * This is the no-script rendering, and it is deliberately the same structure the browser builds
 * element by element once the script runs. The verifier compares the two, because that is the
 * one duplication in this file that cannot be collapsed - markup and DOM calls are different
 * languages - and an unchecked duplication is a drift waiting to happen.
 *
 * @param a  one normalised agent
 * @param sp the result of the shared span rule for that agent
 *
 * @example rowHtml({ state: 'done', known: true, name: 'x', task: '', note: '' },
 *   { text: '2s', why: '', bad: false }).indexOf('ck-ab-s-done') >= 0;   // true
 */
function rowHtml(a, sp) {
  const kind = a.known ? a.state : 'other';

  const bits = ['<span class="ck-ab-name">' + esc(a.name) + '</span>'];
  /* The task is the sentence that says what this agent was actually asked to do, and it is the
     first thing that gets long. It is ellipsised in CSS with the whole of it in a title, so a
     forty-word dispatch cannot set the width of the card. */
  if (a.task !== '') {
    bits.push('<span class="ck-ab-task" title="' + esc(a.task) + '">' + esc(a.task) + '</span>');
  }
  if (a.note !== '') bits.push('<span class="ck-ab-note">' + esc(a.note) + '</span>');

  return '<div class="ck-ab-row ck-ab-s-' + kind + '">' +
         '<span class="ck-ab-pill">' + GLYPHS[kind] +
         '<b>' + esc(a.state === '' ? 'no state' : a.state) + '</b></span>' +
         '<span class="ck-ab-body">' + bits.join('') + '</span>' +
         '<span class="ck-ab-dur' + (sp.bad ? ' ck-ab-odd' : '') + '"' +
         (sp.why !== '' ? ' title="' + esc(sp.why) + '"' : '') + '>' + esc(sp.text) + '</span>' +
         '</div>';
}

/**
 * The whole static list, headings and all, in board order.
 *
 * @param agents the normalised agents
 * @param now    the build-time clock, for the elapsed of everything still out
 *
 * @example listHtml([], 0);   // ''
 */
function listHtml(agents, now) {
  const ordered = CORE.order(agents);
  const counts = Object.create(null);
  for (const a of ordered) {
    const k = CORE.group(a.state);
    counts[k] = (counts[k] || 0) + 1;
  }

  const parts = [];
  let cur = null;
  for (const a of ordered) {
    const key = CORE.group(a.state);
    if (key !== cur) {
      cur = key;
      parts.push('<div class="ck-ab-head ck-h3" data-grp="' + esc(key) + '">' +
                 '<span>' + esc(key) + '</span><b>' + counts[key] + '</b></div>');
    }
    parts.push(rowHtml(a, CORE.span(a, now)));
  }
  return parts.join('');
}

/**
 * The caption's two halves for the no-script case.
 *
 * Both are overwritten by the browser on its first pass; these are what a reader sees when the
 * script never runs, and they must be true in that case rather than optimistic about a fetch
 * that will never happen.
 *
 * @param agents the normalised agents
 * @param now    the build-time clock
 * @param src    the result of {@link live}
 *
 * @example still([], 0, { url: '', note: 'no live source configured' }).state;
 * // 'static list \u2014 no live source configured'
 */
function still(agents, now, src) {
  const state = src.url === ''
    ? 'static list \u2014 ' + src.note
    : 'static list \u2014 the browser has not asked ' + src.url + ' yet';

  let run = 0, bad = 0, unk = 0;
  for (const a of agents) {
    if (a.state === 'running') run += 1;
    if (CORE.span(a, now).bad) bad += 1;
    if (!a.known) unk += 1;
  }

  const parts = [agents.length + (agents.length === 1 ? ' agent' : ' agents')];
  if (agents.length > 0) parts.push(run + ' running');
  if (bad > 0) parts.push(bad + (bad === 1 ? ' row has unusable times' : ' rows have unusable times'));
  if (unk > 0) parts.push(unk + (unk === 1 ? ' row carries an unknown state' : ' rows carry unknown states'));

  return { state, count: parts.join(' \u00b7 ') };
}

/* ── the browser half ────────────────────────────────────────────────────────────────────── */

/**
 * The card's browser half.
 *
 * Written as one string wrapped in a function expression, so nothing this card defines reaches
 * the global scope - a desk can hold two agentboards, and a top-level declaration would have
 * them sharing it. Classic script throughout, checked by {@link assertClassic} before it leaves
 * the build.
 *
 * The browser re-renders the whole list from the embedded static data on its first pass, so
 * that from the moment the script runs there is exactly ONE renderer in effect. Mixing markup
 * Node wrote with rows the browser built would give two rendering paths that must agree forever
 * and are never compared; re-rendering makes the markup a pure no-script fallback instead.
 *
 * @param id     the card's data-card value, embedded as a literal
 * @param agents the normalised static agents, embedded as a literal
 * @param src    the result of {@link live}
 *
 * @example main('board', [], { url: '', note: 'x' }).indexOf('CK.build') >= 0;   // true
 */
function main(id, agents, src) {
  return [
    '  var AB_GLYPH = ' + embed(GLYPHS) + ';',
    '  var AB_POLL = ' + POLL_MS + ';',
    '',
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var box = sec.querySelector(".ck-ab-list");',
    '    if (!box) return;',
    '',
    '    var stateEl = sec.querySelector(".ck-ab-state");',
    '    var countEl = sec.querySelector(".ck-ab-count");',
    '    var noneEl  = sec.querySelector(".ck-ab-none");',
    '    var voidEl  = sec.querySelector(".ck-ab-void");',
    '',
    '    var STATIC   = ' + embed(agents) + ';',
    '    var SRC      = ' + jsStr(src.url) + ';',
    '    var SRC_NOTE = ' + jsStr(src.note) + ';',
    '',
    '    /* view.live is the one flag that decides whether this card may imply it is current.',
    '       Nothing sets it except a fetch that came back with a readable list of agents, and',
    '       everything the caption says branches on it. A board that looks live and is not is',
    '       the failure this card exists to avoid. */',
    '    var view = { rows: STATIC, live: false, at: 0, err: "" };',
    '    var cfg  = ' + embed(defaults) + ';',
    '    var stat = { total: 0, shown: 0, run: 0, bad: 0, unk: 0 };',
    '    var groups = [];',
    '',
    '    function ckNow() { return Date.now(); }',
    '',
    '    function el(tag, cls) {',
    '      var e = document.createElement(tag);',
    '      if (cls) e.className = cls;',
    '      return e;',
    '    }',
    '',
    '    /* The only innerHTML in this card, and it is handed a value from AB_GLYPH - a literal',
    '       written in this file and embedded as a whole object, never anything from the data or',
    '       from the network. The state word beside it goes in through textContent, because that',
    '       IS caller text and an unknown state is spelled however the source spelled it. */',
    '    function pill(a) {',
    '      var p = el("span", "ck-ab-pill"), b = document.createElement("b");',
    '      p.innerHTML = AB_GLYPH[a.known ? a.state : "other"];',
    '      b.textContent = a.state === "" ? "no state" : a.state;',
    '      p.appendChild(b);',
    '      return p;',
    '    }',
    '',
    '    function rowFor(a) {',
    '      var r = el("div", "ck-ab-row ck-ab-s-" + (a.known ? a.state : "other"));',
    '      var body = el("span", "ck-ab-body");',
    '      var nm = el("span", "ck-ab-name");',
    '      nm.textContent = a.name;',
    '      body.appendChild(nm);',
    '      if (a.task !== "") {',
    '        var tk = el("span", "ck-ab-task");',
    '        tk.textContent = a.task;',
    '        tk.setAttribute("title", a.task);',
    '        body.appendChild(tk);',
    '      }',
    '      if (a.note !== "") {',
    '        var nt = el("span", "ck-ab-note");',
    '        nt.textContent = a.note;',
    '        body.appendChild(nt);',
    '      }',
    '      var d = el("span", "ck-ab-dur");',
    '      r.appendChild(pill(a));',
    '      r.appendChild(body);',
    '      r.appendChild(d);',
    '      return { el: r, dur: d, a: a };',
    '    }',
    '',
    '    function render(now) {',
    '      var ordered = ckOrder(view.rows), frag = document.createDocumentFragment();',
    '      var i, a, key, cur = null, h, lab, num, made;',
    '      groups = [];',
    '      for (i = 0; i < ordered.length; i++) {',
    '        a = ordered[i];',
    '        key = ckGroup(a.state);',
    '        if (cur === null || cur.key !== key) {',
    '          h = el("div", "ck-ab-head ck-h3");',
    '          h.setAttribute("data-grp", key);',
    '          lab = document.createElement("span");',
    '          lab.textContent = key;',
    '          num = document.createElement("b");',
    '          h.appendChild(lab);',
    '          h.appendChild(num);',
    '          cur = { key: key, head: h, num: num, rows: [] };',
    '          groups.push(cur);',
    '          frag.appendChild(h);',
    '        }',
    '        made = rowFor(a);',
    '        cur.rows.push(made);',
    '        frag.appendChild(made.el);',
    '      }',
    '      while (box.firstChild) box.removeChild(box.firstChild);',
    '      box.appendChild(frag);',
    '      paint(now);',
    '      applyShow(now);',
    '    }',
    '',
    '    /* Every repaint subtracts a fresh clock reading from the recorded start. Nothing here',
    '       adds a second to a running total, and that is the point: a tab that was throttled or',
    '       asleep for ten minutes comes back showing ten more minutes, not the two hundred',
    '       ticks it was actually given. An accumulator would understate the wait, which is the',
    '       one direction that makes this card useless. */',
    '    function paint(now) {',
    '      var i, k, g, sp, cell;',
    '      for (i = 0; i < groups.length; i++) {',
    '        g = groups[i];',
    '        for (k = 0; k < g.rows.length; k++) {',
    '          sp = ckSpan(g.rows[k].a, now);',
    '          cell = g.rows[k].dur;',
    '          cell.textContent = sp.text;',
    '          cell.className = "ck-ab-dur" + (sp.bad ? " ck-ab-odd" : "");',
    '          if (sp.why !== "") cell.setAttribute("title", sp.why);',
    '          else cell.removeAttribute("title");',
    '        }',
    '      }',
    '    }',
    '',
    '    function wanted(a) {',
    '      if (cfg.show === "running") return a.state === "running";',
    '      if (cfg.show === "unfinished") return a.state === "running" || a.state === "queued";',
    '      return true;',
    '    }',
    '',
    '    function applyShow(now) {',
    '      var i, k, g, vis, ok;',
    '      stat = { total: view.rows.length, shown: 0, run: 0, bad: 0, unk: 0 };',
    '      for (i = 0; i < view.rows.length; i++) {',
    '        if (view.rows[i].state === "running") stat.run = stat.run + 1;',
    '        if (ckSpan(view.rows[i], now).bad) stat.bad = stat.bad + 1;',
    '        if (!view.rows[i].known) stat.unk = stat.unk + 1;',
    '      }',
    '      for (i = 0; i < groups.length; i++) {',
    '        g = groups[i];',
    '        vis = 0;',
    '        for (k = 0; k < g.rows.length; k++) {',
    '          ok = wanted(g.rows[k].a);',
    '          g.rows[k].el.hidden = !ok;',
    '          if (ok) vis = vis + 1;',
    '        }',
    '        /* A heading with nothing under it reads as a category the reader has to go and',
    '           check, so an emptied group hides its heading too. */',
    '        g.head.hidden = vis === 0;',
    '        g.num.textContent = String(vis);',
    '        stat.shown = stat.shown + vis;',
    '      }',
    '      if (voidEl) voidEl.hidden = stat.total !== 0;',
    '      if (noneEl) noneEl.hidden = !(stat.total > 0 && stat.shown === 0);',
    '      caption(now);',
    '    }',
    '',
    '    /* Where the rows came from, in words, every time anything changes. Each branch is a',
    '       different sentence on purpose: "no source", "polling off", "not asked yet", "live",',
    '       "was live and has gone quiet", and "never answered, so this is the static list" are',
    '       six genuinely different situations and collapsing any pair of them would let the',
    '       card imply currency it does not have. */',
    '    function caption(now) {',
    '      var ago = ckDur(Math.max(0, now - view.at)), fresh = view.live && view.err === "";',
    '      var say;',
    '      if (SRC === "") say = "static list \\u2014 " + SRC_NOTE;',
    '      else if (!cfg.poll) say = "static list \\u2014 polling is off in the settings for this card";',
    '      else if (fresh) say = "live \\u2014 updated " + ago + " ago";',
    '      else if (view.live) {',
    '        say = "the live source stopped answering (" + view.err +',
    '              ") \\u2014 this is the list from " + ago + " ago";',
    '      } else if (view.err !== "") {',
    '        say = "showing a static list because no live source answered (" + view.err + ")";',
    '      } else say = "static list \\u2014 waiting for the first answer from " + SRC;',
    '',
    '      if (stateEl) stateEl.textContent = say;',
    '      sec.classList.toggle("ck-ab-stale", !fresh);',
    '',
    '      if (!countEl) return;',
    '      var parts = [stat.total + (stat.total === 1 ? " agent" : " agents")];',
    '      if (stat.total > 0) parts.push(stat.run + " running");',
    '      if (stat.shown !== stat.total) parts.push(stat.shown + " shown");',
    '      if (stat.bad > 0) {',
    '        parts.push(stat.bad + (stat.bad === 1 ? " row has unusable times"',
    '                                             : " rows have unusable times"));',
    '      }',
    '      if (stat.unk > 0) {',
    '        parts.push(stat.unk + (stat.unk === 1 ? " row carries an unknown state"',
    '                                              : " rows carry unknown states"));',
    '      }',
    '      countEl.textContent = parts.join(" \\u00b7 ");',
    '    }',
    '',
    '    /* A failed pull never leaves the old picture looking current. If nothing has ever come',
    '       back, the board drops to the static list and the caption says why; if a good list is',
    '       already on screen it stays - throwing away real data over one bad response would be',
    '       worse - but the caption changes to say when it was last true. */',
    '    function pull() {',
    '      if (SRC === "" || !cfg.poll) return;',
    '      fetch(SRC, { cache: "no-store" }).then(function (r) {',
    '        if (!r.ok) throw new Error("HTTP " + r.status);',
    '        return r.text();',
    '      }).then(function (t) {',
    '        var body = null, fine = true, rows;',
    '        try { body = JSON.parse(t); } catch (bad) { fine = false; }',
    '        if (!fine) throw new Error("the answer was not JSON");',
    '        rows = ckNormalize(body);',
    '        if (rows === null) throw new Error("the answer was not a list of agents");',
    '        view.rows = rows;',
    '        view.live = true;',
    '        view.err = "";',
    '        view.at = ckNow();',
    '        render(view.at);',
    '      }).catch(function (why) {',
    '        view.err = why && why.message ? String(why.message) : "no answer";',
    '        if (view.live) caption(ckNow());',
    '        else { view.rows = STATIC; render(ckNow()); }',
    '      });',
    '    }',
    '',
    '    CK.settings(sec, ' + embed(defaults) + ', function (got) {',
    '      cfg = got;',
    '      sec.classList.toggle("ck-ab-dense", !!cfg.dense);',
    '      applyShow(ckNow());',
    '    });',
    '',
    '    render(ckNow());',
    '',
    '    /* Both timers are created on every build and gated inside, rather than created only',
    '       when wanted. CK.timer is keyed by name in a registry that outlives the DOM, so',
    '       creating it again replaces the old one; skipping the call on a swap would leave the',
    '       PREVIOUS interval running against a detached card forever, which is exactly the',
    '       doubling CK.timer exists to prevent. An idle interval costs nothing; a leaked one',
    '       costs a fetch every five seconds for the life of the tab. */',
    '    CK.timer(' + jsStr(id + ':ab-tick') + ', 1000, function () {',
    '      var now = ckNow();',
    '      paint(now);',
    '      caption(now);',
    '    });',
    '    CK.timer(' + jsStr(id + ':ab-poll') + ', AB_POLL, pull);',
    '  });'
  ].join('\n');
}

/* ── the build ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build one agentboard card.
 *
 * @param id    the card's directory name; becomes its data-card attribute
 * @param title the card's heading, rendered as plain text
 * @param data  '{ url, agents, now }'; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns '{ json, html, css, js }'
 * @throws {Error} when the emitted script is not a classic script, which would blank the
 *   whole desk rather than only this card
 *
 * @example
 * build({ id: 'board', title: 'agents', ord: 2, data: {
 *   now: 1000000,
 *   agents: [{ id: 'r1', name: 'reader', task: 'read the contract',
 *              state: 'running', started: 999000 }]
 * } }).html.indexOf('data-card="board"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};

  const agents = CORE.norm(d.agents) || [];
  const src = live(d.url);
  const now = CORE.time(d.now) === null ? Date.now() : CORE.time(d.now);

  const said = still(agents, now, src);

  const rows = listHtml(agents, now);
  const void_ = '<div class="ck-ab-void"' + (agents.length === 0 ? '' : ' hidden') + '>' +
                'nothing has been dispatched</div>';
  const none = '<div class="ck-ab-none" hidden>' +
               'nothing matches the show setting for this card</div>';

  const caption = (d.caption == null ? '' : esc(CORE.clean(d.caption)) + ' ') +
                  '<i class="ck-ab-state">' + esc(said.state) + '</i> ' +
                  '<span class="ck-aside ck-ab-count">' + esc(said.count) + '</span>';

  const html =
    '<section data-card="' + esc(id) + '" class="ck-agentboard ck-ab-stale">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-poll">poll the source</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-poll" name="poll">\n' +
    '    <label for="' + esc(id) + '-show">show</label>\n' +
    '    <select id="' + esc(id) + '-show" name="show">' +
    '<option value="all">all</option>' +
    '<option value="running">running only</option>' +
    '<option value="unfinished">running and queued</option>' +
    '</select>\n' +
    '    <label for="' + esc(id) + '-dense">dense rows</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-dense" name="dense">\n' +
    '    <div class="ck-set-foot">the board polls every ' + Math.round(POLL_MS / 1000) +
    ' seconds. with polling off the list is whatever the page was built with, and the caption ' +
    'says so.</div>\n' +
    '  </div>\n' +
    '  ' + void_ + '\n' +
    '  <div class="ck-ab-list">' + rows + '</div>\n' +
    '  ' + none + '\n' +
    '  <div class="ck-cap">' + caption + '</div>\n' +
    '</section>\n';

  const js = assertClassic('(function () {\n' + CORE_SRC + '\n\n' + main(id, agents, src) +
                           '\n})();\n', 'js');

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off prefers-color-scheme. The
   desk is one document open in two viewers who want different answers, and the OS only knows
   how to give both of them the same one. */
const CSS = `
  .ck-agentboard { position: relative; }

  /* A checkbox inherits the panel's full-width input rule and comes out as a stretched box;
     it wants to be its own size, at the start of its column. */
  .ck-agentboard .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  /* The list scrolls inside itself rather than growing the card without limit: two hundred
     agents is a real number and a card is not a page. */
  .ck-agentboard .ck-ab-list { margin-top: 8px; max-height: 60vh; overflow-y: auto; }

  /* ── headings ───────────────────────────────────────────────────────────────────────── */

  .ck-agentboard .ck-ab-head {
    display: flex; align-items: baseline; gap: 8px; margin: 13px 0 4px;
  }
  .ck-agentboard .ck-ab-head:first-child { margin-top: 2px; }
  .ck-agentboard .ck-ab-head[hidden] { display: none; }
  .ck-agentboard .ck-ab-head b {
    font: 400 10px/1 var(--mono); color: var(--ink-faint); font-variant-numeric: tabular-nums;
  }

  /* ── rows ───────────────────────────────────────────────────────────────────────────── */

  /* The left rule is the load-bearing part of the state treatment: it survives greyscale, it
     survives a colour-blind reader, and it is visible from across the desk in a way a tinted
     word is not. Every row reserves it so that turning it on does not shift the text. */
  .ck-agentboard .ck-ab-row {
    display: flex; align-items: baseline; gap: 9px;
    padding: 6px 4px 6px 7px;
    border-bottom: 1px solid var(--hairline);
    border-left: 2px solid transparent;
  }
  .ck-agentboard .ck-ab-row[hidden] { display: none; }
  .ck-agentboard .ck-ab-row:hover { background: var(--pill); }
  .ck-agentboard.ck-ab-dense .ck-ab-row { padding: 2px 4px 2px 7px; gap: 7px; }
  .ck-agentboard.ck-ab-dense .ck-ab-note { display: none; }

  .ck-agentboard .ck-ab-pill {
    flex: none; display: inline-flex; align-items: center; gap: 5px; min-width: 72px;
    font-family: var(--mono); font-size: 9.5px; letter-spacing: .05em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  .ck-agentboard .ck-ab-pill svg { width: 12px; height: 12px; flex: none; display: block; }
  .ck-agentboard .ck-ab-pill b { font-weight: 400; }

  .ck-agentboard .ck-ab-body { flex: 1 1 auto; min-width: 0; }

  /* Ellipsis rather than wrap on the two long fields, so a forty-word dispatch cannot set the
     width of the card or of the desk column it sits in. The whole string stays in a title. */
  .ck-agentboard .ck-ab-name {
    display: block; font-size: 12.5px; line-height: 1.4; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ck-agentboard .ck-ab-task {
    display: block; font-size: 11.5px; line-height: 1.4; color: var(--ink-dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ck-agentboard .ck-ab-note {
    display: block; font-size: 11px; line-height: 1.4; color: var(--ink-faint); margin-top: 1px;
  }

  /* Tabular figures so the column of durations holds its places while they tick. */
  .ck-agentboard .ck-ab-dur {
    flex: none; min-width: 58px; text-align: right;
    font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums;
    color: var(--ink-dim);
  }
  /* A duration this card could not compute is marked as well as worded, and the title says
     which of the several reasons it was. */
  .ck-agentboard .ck-ab-odd { border-bottom: 1px dotted var(--ck-s2); color: var(--ink-faint); }

  /* ── the quiet weight difference ────────────────────────────────────────────────────── */

  /* Running is the only group whose numbers are still moving, so it gets full ink, a heavier
     name and a lit rule. Done recedes without disappearing. Failed keeps full weight because
     it is the row most likely to need a decision. */
  .ck-agentboard .ck-ab-s-running { border-left-color: var(--accent); }
  .ck-agentboard .ck-ab-s-running .ck-ab-pill { color: var(--accent); }
  .ck-agentboard .ck-ab-s-running .ck-ab-name { font-weight: 600; }
  .ck-agentboard .ck-ab-s-running .ck-ab-dur { color: var(--ink); }

  .ck-agentboard .ck-ab-s-queued .ck-ab-name { color: var(--ink-dim); }

  .ck-agentboard .ck-ab-s-done { opacity: .62; }
  .ck-agentboard .ck-ab-s-done .ck-ab-pill { color: var(--good); }
  .ck-agentboard .ck-ab-s-done:hover { opacity: .9; }

  .ck-agentboard .ck-ab-s-failed { border-left-color: var(--ck-s1); background: var(--well); }
  .ck-agentboard .ck-ab-s-failed .ck-ab-pill { color: var(--ck-s1); font-weight: 700; }

  .ck-agentboard .ck-ab-s-other .ck-ab-pill { color: var(--ck-s2); }

  /* ── the two empties ────────────────────────────────────────────────────────────────── */

  .ck-agentboard .ck-ab-void, .ck-agentboard .ck-ab-none {
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
    padding: 14px 4px; text-align: center;
  }
  .ck-agentboard .ck-ab-void[hidden], .ck-agentboard .ck-ab-none[hidden] { display: none; }

  /* ── the caption ────────────────────────────────────────────────────────────────────── */

  /* The provenance clause is the most important sentence on the card, so it is the one piece
     of caption that is not faint. It goes quiet, not loud, when the board is not live: a
     stale board should not shout, it should stop looking current. */
  .ck-agentboard .ck-ab-state { font-style: normal; color: var(--accent); }
  .ck-agentboard.ck-ab-stale .ck-ab-state { color: var(--ck-s2); }
  .ck-agentboard .ck-ab-count { color: var(--ink-faint); }
`;
