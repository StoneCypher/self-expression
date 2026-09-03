/**
 * @file cardkit card type: 'countdown' — how long until a fixed moment, and how long since.
 *
 * The one idea this card is built around is that a duration and a calendar are different things
 * and must not be mixed. The arithmetic is done on INSTANTS: two epoch-millisecond numbers,
 * subtracted, with a day defined as 86,400,000 milliseconds. The display of the target itself is
 * done in the viewer's local WALL CLOCK, by Intl, in the viewer's own zone.
 *
 * Counting the days off a calendar instead is the tempting version and it is wrong in a way that
 * only shows up twice a year: a calendar day across a daylight-saving boundary is 23 hours or 25,
 * so "3 days" would mean a different length of time depending on which weekend it spanned, and the
 * hours and minutes underneath it would not add up to it. A countdown is a duration. The only wall
 * clock on this card is the line saying when the target actually falls.
 *
 * Written without a single backtick anywhere in the file, and the browser half is built from an
 * array of lines rather than a template literal. That is not style: the whole deck's scripts are
 * concatenated into ONE inline block, so a stray backtick — in a comment, even — turns the rest of
 * the deck into a template literal and blanks every card on the desk. A file with no backtick in
 * it cannot make that mistake, and {@link guardEmitted} refuses to return a script that did.
 *
 * @see ../CONTRACT.md — the rules this type is checked against
 * @see ../kit.js      — CK.settings, CK.timer, CK.build
 * @see ../kit.css     — .ck-gear, .ck-set, .ck-cap and the token vocabulary
 */

/**
 * Every setting the countdown understands, with the value it falls back to.
 *
 * 'unitsShown' is 'auto' or the strings '2', '3', '4' — 'auto' drops leading units that are zero,
 * so a countdown inside the last hour stops claiming a column of noughts, while a number pins that
 * many units counting down from days, which is what you want when the card must not change width.
 * 'seconds' removes the seconds column entirely rather than freezing it. 'past' chooses what
 * happens once the moment has gone by: keep counting, or stop at zero.
 */
export const defaults = { unitsShown: 'auto', seconds: true, past: 'up' };

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * 'shape' is a string on purpose — a human choosing a type reads it at a glance. 'defaults' is the
 * machine-readable half, spread from {@link defaults} rather than restated, so there is one written
 * source and two ways to reach it.
 *
 * @example meta.name;                  // 'countdown'
 * @example Object.keys(meta.defaults); // ['unitsShown', 'seconds', 'past']
 */
export const meta = {
  name: 'countdown',
  summary: 'Time remaining to a fixed instant, dropping empty units and counting up once it has passed.',
  shape: '{ target, label, unitsShown, past } — target an ISO instant, unitsShown "auto" | 2 | 3 | 4, past "up" | "stop", label free text',
  category: 'live-and-ambient',
  defaults: { ...defaults },
};

/** The legal 'unitsShown' values, as strings, because that is what a select yields. */
const UNIT_CHOICES = ['auto', '2', '3', '4'];

/** The legal 'past' values. */
const PAST_CHOICES = ['up', 'stop'];

/** What the card says when the target is not a moment in time. Never the word for a non-number. */
const BAD_TARGET = 'the target could not be read as a moment in time';

/** How often the browser repaints. The reading does not depend on this number. */
const TICK_MS = 250;

/**
 * How far the device clock must jump backwards before the card mentions it, in milliseconds.
 *
 * NTP nudges a system clock by tens of milliseconds as a matter of routine and that is not news.
 * A jump of seconds is, because this card is a subtraction from the device clock and will follow
 * it exactly — the number will visibly go the wrong way, and the viewer is owed the reason.
 */
const BACKWARDS_MS = 2000;

/**
 * HTML-escape a build-time value, mirroring CK.esc so Node-built markup and browser-built markup
 * cannot disagree about what is safe.
 *
 * @param s anything; null and undefined become the empty string rather than their names
 *
 * @example esc('</h2><img src=x>');   // '&lt;/h2&gt;&lt;img src=x&gt;'
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JavaScript string literal for a value, safe to paste into the emitted classic script.
 *
 * JSON.stringify alone is not enough for text landing inside a script element: '</' would close it
 * early and the rest of the deck would render as text, and U+2028 / U+2029 are line terminators to
 * a JavaScript parser but not to JSON. The backtick and the question mark are escaped for a
 * different reason — this type's verification asserts the emitted script holds no template literal
 * and no optional chaining, and a target string containing either would fail that check with a
 * message about a rule it did not break.
 *
 * @param s the text to embed
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\?/g, '\\u003f').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A JSON object literal for the emitted script, escaped the same way as {@link jsStr}.
 *
 * @param v a plain object of numbers, booleans and strings
 *
 * @example jsObj({ seconds: true });   // '{"seconds":true}'
 */
function jsObj(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\?/g, '\\u003f').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Read a target into an instant, or into nothing at all.
 *
 * Accepts an ISO string, an epoch-millisecond number, or a Date. Anything else — a typo, an empty
 * string, a date the engine will not parse, a value past the range a Date can hold — comes back as
 * null, and the card says so and shows the raw text rather than rendering the word engines use for
 * a non-number, which tells a viewer nothing and looks like a crash.
 *
 * @param v the caller's 'target'
 * @returns epoch milliseconds, or null when the value is not a moment
 *
 * @example instantOf('2026-12-25T00:00:00Z');   // 1766620800000
 * @example instantOf('next tuesday');           // null
 */
function instantOf(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fold caller-supplied data onto the defaults, keeping anything the card can honour.
 *
 * Seeding is coercive rather than strict, because a card descriptor may be a hand-edited file and
 * a typo in 'past' should give a working countdown rather than an empty box. The target is the one
 * value not coerced: an unreadable one is carried through as a refusal, because guessing at what
 * someone meant by a date is how a card ends up counting down to the wrong thing confidently.
 *
 * @param data '{ target, label, unitsShown, past }'; missing and null keys keep their default
 *
 * @example settle({ target: '2027-01-01T00:00:00Z', past: 'stop' }).cfg.past;   // 'stop'
 * @example settle({ target: 'soon' }).target;                                   // null
 */
function settle(data) {
  const cfg = { ...defaults };
  const src = data && typeof data === 'object' ? data : {};

  for (const k of Object.keys(defaults)) {
    if (Object.hasOwn(src, k) && src[k] != null) cfg[k] = src[k];
  }
  cfg.unitsShown = UNIT_CHOICES.includes(String(cfg.unitsShown))
    ? String(cfg.unitsShown) : defaults.unitsShown;
  cfg.past = PAST_CHOICES.includes(cfg.past) ? cfg.past : defaults.past;
  cfg.seconds = !!cfg.seconds;

  return {
    cfg,
    target: instantOf(src.target),
    raw: src.target == null ? '' : String(src.target),
    label: src.label == null ? '' : String(src.label),
  };
}

/**
 * The option list for a select, with the seeded value already chosen.
 *
 * CK.settings reflects stored values onto the controls when the panel is wired, but marking the
 * seed here means a static render of the card is correct before any script has run.
 */
function options(pairs, chosen) {
  return pairs
    .map(([value, text]) =>
      '<option value="' + esc(value) + '"' + (value === chosen ? ' selected' : '') + '>' +
      esc(text) + '</option>')
    .join('');
}

/**
 * The unit letters this card could ever show, largest first.
 *
 * Which of them actually appear is decided in the browser, by the seconds setting and by whether
 * leading units are zero — neither of which Node can know at build time, because "now" at build
 * time is not "now" at render time. So the markup ships placeholders in the right shape and the
 * first tick fills them in, which means the card has the right skeleton before any script runs.
 *
 * @param seconds whether the seconds column is wanted
 *
 * @example unitKeys(false);   // ['d', 'h', 'm']
 */
function unitKeys(seconds) {
  return seconds ? ['d', 'h', 'm', 's'] : ['d', 'h', 'm'];
}

/**
 * The card's markup: heading, gear, settings panel, unit blocks, the target line, caption.
 *
 * The gear button is emitted empty on purpose — CK.settings fills it with a drawn gear, and a
 * glyph typed here would be a second source of truth for a shape the kit already owns. The
 * settings panel holds exactly the keys of {@link defaults}, in both directions.
 *
 * @param id     the card's data-card value
 * @param title  the heading
 * @param cfg    the settled settings
 * @param target the parsed instant, or null
 * @param raw    the target exactly as it was given, for the refusal case
 * @param label  the card's own subtitle, or the empty string
 * @param ord    the card's position on the desk
 */
function markup(id, title, cfg, target, raw, label, ord) {
  const f = (name) => esc(id) + '-' + name;
  const bad = target === null;

  const placeholders = unitKeys(cfg.seconds)
    .map((k) => '<span class="ck-u"><b>--</b><i>' + esc(k) + '</i></span>')
    .join('');

  return '<section data-card="' + esc(id) + '" class="ck-countdown"' +
    ' data-state="' + (bad ? 'bad' : 'wait') + '" data-wide="off"' +
    ' data-ord="' + esc(ord) + '">' +

    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="countdown settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('unitsShown') + '">units</label>' +
      '<select id="' + f('unitsShown') + '" name="unitsShown">' +
        options([['auto', 'auto — drop empty units'], ['2', 'two'], ['3', 'three'], ['4', 'four']],
                cfg.unitsShown) +
      '</select>' +

      '<label for="' + f('seconds') + '">seconds</label>' +
      '<input id="' + f('seconds') + '" name="seconds" type="checkbox"' +
        (cfg.seconds ? ' checked' : '') + '>' +

      '<label for="' + f('past') + '">once it passes</label>' +
      '<select id="' + f('past') + '" name="past">' +
        options([['up', 'count up'], ['stop', 'stop at zero']], cfg.past) +
      '</select>' +

      '<p class="ck-set-foot">A number pins that many units, counting from days, so the card ' +
        'keeps its width; auto drops the leading ones while they are zero.</p>' +
    '</div>' +

    '<div class="ck-units" role="group" aria-label="time remaining">' +
      (bad ? '<span class="ck-bad">' + esc(BAD_TARGET) + '</span>' : placeholders) +
    '</div>' +

    /* Before the script runs there is no local zone to format in, so the target line carries the
       value exactly as it was written. The first tick replaces it with the same instant in the
       viewer's own wall clock. */
    '<div class="ck-when">' + esc(raw) + '</div>' +

    '<div class="ck-cap" aria-live="polite">' + esc(label) + '</div>' +
  '</section>';
}

/**
 * Every rule, scoped under .ck-countdown, built from tokens only.
 *
 * No literal colour appears anywhere: the desk is one document open in two viewers that want
 * opposite themes, so a hex here would be wrong in exactly one of them. prefers-color-scheme is
 * likewise untouched, because the viewer's stamped choice has to beat the operating system's.
 *
 * Nothing animates, so there is nothing for reduced motion to switch off — the card's whole
 * behaviour is a number changing, which is information rather than movement.
 */
function styles() {
  return [
    '.ck-countdown { position: relative; }',

    '.ck-countdown .ck-units { display: flex; align-items: baseline; gap: 15px; flex-wrap: wrap; }',
    '.ck-countdown .ck-u { display: inline-flex; align-items: baseline; gap: 3px; }',
    '.ck-countdown .ck-u b { font: 400 34px/1 var(--disp); color: var(--ink); font-weight: 400;' +
      ' font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }',
    '.ck-countdown .ck-u i { font: 400 12px/1 var(--ui); font-style: normal; color: var(--ink-faint); }',

    /* A target thousands of years out is a five- or six-digit day count. Rather than let it wrap
       or push the card sideways, the figures step down once the leading one stops being short. */
    '.ck-countdown[data-wide="on"] .ck-u b { font-size: 21px; }',

    '.ck-countdown[data-state="past"] .ck-u b { color: var(--ink-dim); }',
    '.ck-countdown[data-state="reached"] .ck-u b { color: var(--ink-dim); }',
    '.ck-countdown[data-state="now"] .ck-u b { color: var(--accent); }',

    '.ck-countdown .ck-ago { align-self: center; font: 700 11px/1 var(--ui);' +
      ' letter-spacing: 0.09em; text-transform: uppercase; color: var(--accent); }',

    '.ck-countdown .ck-bad { font: 400 13px/1.45 var(--ui); color: var(--ink-dim); }',

    '.ck-countdown .ck-when { margin-top: 10px; font: 400 11.5px/1.4 var(--ui);' +
      ' color: var(--ink-dim); overflow-wrap: anywhere; }',

    /* kit.css stretches settings fields to their cell; a stretched checkbox is a wide hit area
       with a glyph adrift in it, so this one control opts out. */
    '.ck-countdown .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',

    '.ck-countdown .ck-cap { overflow-wrap: anywhere; }',
  ].join('\n');
}

/** Characters after which a slash opens a regular expression rather than dividing. */
const REGEX_AFTER = '(,=:[!&|?{};+-*%~^<>';

/**
 * A copy of the source with every comment body and every string body replaced by spaces, at the
 * same offsets and the same length.
 *
 * This exists so the keyword scan in {@link guardEmitted} can look at code and only code. A raw
 * scan for 'const', 'let' and 'class' fires on English — a sibling card was refused tonight
 * because one of its own comments said "the class is what CSS reads" — and a guard that cries
 * wolf is a guard somebody deletes. Offsets are preserved rather than the text being stripped,
 * so a reported position still points at the real line.
 *
 * Regular expression literals are recognised too, and they have to be: the emitted script holds
 * replace(/'/g, ...), and a scanner that read that quote as the start of a string would fall out
 * of step and blank real code — which would turn a false positive into the much worse false
 * negative. The heuristic is the usual one, that a slash opens a pattern only where a value
 * cannot already have ended.
 *
 * @param src any JavaScript text
 * @returns the same length of text with only code left legible
 *
 * @example blankNonCode('var a = "let";').indexOf('let');   // -1
 */
function blankNonCode(src) {
  const out = src.split('');
  const wipe = (from, to) => {
    for (let k = Math.max(0, from); k < Math.min(to, src.length); k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };

  let i = 0;
  let lastSig = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];

    if (c === '/' && d === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      wipe(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      wipe(i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j += 1; break; }
        if (src[j] === '\n') break;
        j += 1;
      }
      wipe(i + 1, j - 1);                       // the quotes stay; only the body goes
      i = j; lastSig = c; continue;
    }
    if (c === '/' && (lastSig === '' || REGEX_AFTER.indexOf(lastSig) >= 0)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < src.length) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') break;
        if (inClass) { if (ch === ']') inClass = false; }
        else if (ch === '[') inClass = true;
        else if (ch === '/') { j += 1; closed = true; break; }
        j += 1;
      }
      if (closed) {
        while (j < src.length && src[j] >= 'a' && src[j] <= 'z') j += 1;   // the flags
        wipe(i, j); i = j; lastSig = '/'; continue;
      }
    }

    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') lastSig = c;
    i += 1;
  }
  return out.join('');
}

/**
 * Refuse to hand back a script the desk cannot swallow.
 *
 * Every card's script is concatenated into one inline block, so a single modern-syntax token in
 * one card is a parse error that blanks every card on the page. Four separate cards shipped that
 * bug in one evening and three of the four did it from a comment rather than from code — which is
 * why this throws at build time instead of trusting a review to catch it. A build that fails
 * loudly is strictly better than a desk that renders nothing and says nothing.
 *
 * The two scans are deliberately different. A backtick, an arrow and an optional chain are checked
 * against the raw text, because none of the three can appear innocently in a classic script: a
 * backtick in a comment is exactly the bug, so exempting comments would exempt the failure. The
 * declaration keywords are checked against {@link blankNonCode} instead, because 'const', 'let'
 * and 'class' are all ordinary English and a guard that refuses a card over its own prose is a
 * guard that gets deleted.
 *
 * @param src   the assembled script text
 * @param where the type's name, for the message
 * @returns the same text, when it is safe
 *
 * @throws {Error} naming the offending token, its offset and the text around it
 *
 * Exported rather than kept private for one reason: a guard nothing exercises is a guard that
 * quietly stops working. This one is asserted against directly — each banned token, and each
 * innocent lookalike — so "the card is protected" is a tested claim and not a hopeful one.
 *
 * @example guardEmitted('var a = 1;', 'countdown');   // 'var a = 1;'
 */
export function guardEmitted(src, where) {
  const near = (at) => src.slice(Math.max(0, at - 70), at + 70);

  const banned = [
    [String.fromCharCode(96), 'a backtick, which would make the rest of the deck a template literal'],
    ['=>', 'an arrow function'],
    ['?.', 'optional chaining'],
  ];
  for (const [needle, why] of banned) {
    const at = src.indexOf(needle);
    if (at >= 0) {
      throw new Error('cardkit/' + where + ': emitted js contains ' + why + ' at offset ' + at +
                      ' — near: ' + near(at));
    }
  }

  const decl = /\b(const|let|class)\b/.exec(blankNonCode(src));
  if (decl) {
    throw new Error('cardkit/' + where + ': emitted js uses the reserved word ' + decl[1] +
                    ' at offset ' + decl.index + ' — near: ' + near(decl.index));
  }

  /* Every byte below 0x20 that is not tab, newline or carriage return, compared arithmetically
     rather than matched against a character class — writing the class is how the class gets
     corrupted, and a corrupted one still looks plausible on the page. */
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 127) {
      throw new Error('cardkit/' + where + ': emitted js holds control character ' + c +
                      ' at offset ' + i);
    }
  }
  return src;
}

/**
 * The card's browser half: the subtraction, the unit picking, the wall-clock line.
 *
 * Written as an array of lines rather than a template literal, so no backtick can exist in this
 * file at all and therefore none can reach the emitted script. Everything is wrapped in an IIFE by
 * {@link script}, because a desk can hold two countdown cards and a top-level var would have them
 * sharing state.
 *
 * @param id     the card's data-card value, embedded as a literal
 * @param cfg    the settled settings this card starts from
 * @param target the parsed instant, or null when the target could not be read
 * @param raw    the target exactly as given, shown when it could not be read
 * @param label  the card's subtitle, or the empty string
 *
 * @example main('c1', defaults, 0, '', '').indexOf('CK.build') > 0;   // true
 */
function main(id, cfg, target, raw, label) {
  return [
    '  var ID     = ' + jsStr(id) + ';',
    '  var TARGET = ' + (target === null ? 'null' : String(target)) + ';',
    '  var RAW    = ' + jsStr(raw) + ';',
    '  var LABEL  = ' + jsStr(label) + ';',
    '  var DEF    = ' + jsObj(cfg) + ';',
    '  var TICK   = ' + TICK_MS + ';',
    '  var BACK   = ' + BACKWARDS_MS + ';',
    '  var BADMSG = ' + jsStr(BAD_TARGET) + ';',
    '',
    '  /* A local copy of CK.esc, so nothing written into the card can become an injection point',
    '     even if the kit is ever loaded in a reduced form on some other desk. */',
    '  function esc(s) {',
    '    return String(s == null ? "" : s)',
    '      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")',
    '      .replace(/"/g, "&quot;").replace(/\'/g, "&#39;");',
    '  }',
    '',
    '  function pad2(v) { return (v < 10 ? "0" : "") + v; }',
    '',
    '  /* Thousand separators, hand-rolled. toLocaleString would group by the viewer locale, and',
    '     these figures sit in a fixed row that should not change shape by region. */',
    '  function group(n) {',
    '    var s = String(n), out = "", i = s.length;',
    '    while (i > 3) { out = "," + s.slice(i - 3, i) + out; i -= 3; }',
    '    return s.slice(0, i) + out;',
    '  }',
    '',
    '  /* Days, hours, minutes and seconds of a DURATION — never of a calendar. A day here is',
    '     86,400,000 milliseconds, full stop. Counting calendar days would need a zone, and a',
    '     calendar day across a daylight-saving boundary is 23 hours or 25, so the figures under',
    '     it would stop adding up to it twice a year and nothing would report an error. */',
    '  function unitVals(ms, wantSeconds) {',
    '    var t = Math.floor((ms > 0 ? ms : 0) / 1000);',
    '    var out = [',
    '      { k: "d", v: Math.floor(t / 86400) },',
    '      { k: "h", v: Math.floor(t / 3600) % 24 },',
    '      { k: "m", v: Math.floor(t / 60) % 60 }',
    '    ];',
    '    if (wantSeconds) out.push({ k: "s", v: t % 60 });',
    '    return out;',
    '  }',
    '',
    '  /* "auto" reads as 0 here, and so does any value the panel could not have produced. */',
    '  function pinOf(cfg) {',
    '    var n = Math.floor(Number(cfg.unitsShown));',
    '    if (!isFinite(n) || n < 2) return 0;',
    '    return n > 4 ? 4 : n;',
    '  }',
    '',
    '  /* Which units to show. A pin takes that many from the top, zeroes included, because the',
    '     reason to pin is to stop the card changing width. Auto drops leading zeroes but never',
    '     the last unit, so a card that has run down to nothing still shows a nought rather than',
    '     an empty row. */',
    '  function pick(vals, pin) {',
    '    var i = 0;',
    '    if (pin > 0) return vals.slice(0, pin > vals.length ? vals.length : pin);',
    '    while (i < vals.length - 1 && vals[i].v === 0) i += 1;',
    '    return vals.slice(i);',
    '  }',
    '',
    '  /* Markup from numbers and fixed literals only: every value here came out of Math.floor a',
    '     line ago, and the unit letters are literals written just above. Escaped anyway, because',
    '     the day one of these arrives from data instead is the day that stops being true. */',
    '  function blocks(list) {',
    '    var out = "", i, u;',
    '    for (i = 0; i < list.length; i += 1) {',
    '      u = list[i];',
    '      out += "<span class=\\"ck-u\\"><b>" + esc(i === 0 ? group(u.v) : pad2(u.v)) +',
    '             "</b><i>" + esc(u.k) + "</i></span>";',
    '    }',
    '    return out;',
    '  }',
    '',
    '  CK.build(ID, function (sec) {',
    '',
    '    var units = sec.querySelector(".ck-units"),',
    '        when  = sec.querySelector(".ck-when"),',
    '        cap   = sec.querySelector(".ck-cap");',
    '',
    '    var cfg  = null;',
    '    var prev = 0;',
    '    var backwards = false;',
    '    var whenFmt = null;',
    '    var last = { units: "", when: "", cap: "", state: "", wide: "" };',
    '',
    '    /* The wall-clock half, and the ONLY wall-clock half. Intl is asked in whatever zone the',
    '       viewer is sitting in, because "when does this fall for me" is a question about a place',
    '       — and the arithmetic above is deliberately not. */',
    '    function whenText() {',
    '      if (TARGET === null) return RAW ? ("the value given was: " + RAW) : "no target was given";',
    '      try {',
    '        if (!whenFmt) {',
    '          whenFmt = new Intl.DateTimeFormat(undefined, {',
    '            weekday: "short", year: "numeric", month: "short", day: "numeric",',
    '            hour: "numeric", minute: "2-digit", timeZoneName: "short"',
    '          });',
    '        }',
    '        return "target " + whenFmt.format(new Date(TARGET));',
    '      } catch (e) {',
    '        /* A target far enough out that a formatter refuses it is still a real instant, and',
    '           the countdown above it is still correct; only this line has to give up. */',
    '        return "target " + RAW;',
    '      }',
    '    }',
    '',
    '    function caption(state, stop) {',
    '      var bits = [];',
    '      if (LABEL) bits.push("<b>" + esc(LABEL) + "</b>");',
    '      if (TARGET === null) {',
    '        bits.push("<i>nothing to count to</i>");',
    '        return bits.join(" ");',
    '      }',
    '      if (state === "future") bits.push("<i>counting down</i>");',
    '      else if (state === "now") bits.push("<i>the moment is now</i>");',
    '      else bits.push(stop ? "<i>reached, and stopped at zero</i>"',
    '                          : "<i>counting up since it passed</i>");',
    '      bits.push("<span class=\\"ck-aside\\">days here are 24-hour spans; the line above is " +',
    '                "your own wall clock</span>");',
    '      if (backwards) {',
    '        bits.push("<span class=\\"ck-aside\\">the device clock moved backwards, and this " +',
    '                  "reading follows it</span>");',
    '      }',
    '      return bits.join(" ");',
    '    }',
    '',
    '    function setHTML(el, key, val) {',
    '      if (last[key] === val) return;',
    '      last[key] = val;',
    '      if (el) el.innerHTML = val;',
    '    }',
    '',
    '    function setAttr(key, name, val) {',
    '      if (last[key] === val) return;',
    '      last[key] = val;',
    '      sec.setAttribute(name, val);',
    '    }',
    '',
    '    function render() {',
    '      if (!cfg) return;',
    '      var now = Date.now();',
    '',
    '      /* This card is a subtraction from the device clock, so it follows the clock exactly,',
    '         including backwards. A viewer watching the figure climb when it should fall is owed',
    '         the reason, and the reason is the machine rather than the card. */',
    '      if (prev !== 0 && prev - now > BACK) backwards = true;',
    '      prev = now;',
    '',
    '      /* Written before the refusal branch and compared on the TEXT rather than on the raw',
    '         target: an unreadable target is often an empty one, and comparing against the raw',
    '         value meant the empty case matched the initial empty state and the line never got',
    '         written at all. The card said nothing precisely where it had most to say. */',
    '      var w = whenText();',
    '      if (when && w !== last.when) { last.when = w; when.textContent = w; }',
    '',
    '      if (TARGET === null) {',
    '        setAttr("state", "data-state", "bad");',
    '        setHTML(units, "units", "<span class=\\"ck-bad\\">" + esc(BADMSG) + "</span>");',
    '        setHTML(cap, "cap", caption("bad", false));',
    '        return;',
    '      }',
    '',
    '      /* Instants, both of them. Nothing here touches a calendar. */',
    '      var diff = TARGET - now;',
    '      var away = diff < 0 ? -diff : diff;',
    '      var stop = cfg.past === "stop";',
    '      var state = away < 1000 ? "now" : diff > 0 ? "future" : "past";',
    '',
    '      /* Exactly at the target, and for the second either side of it, the card says so',
    '         rather than flickering between a 1 and a 0 in the smallest unit shown. */',
    '      var show = state === "future" ? diff : (state === "now" || stop) ? 0 : away;',
    '',
    '      var list = pick(unitVals(show, !!cfg.seconds), pinOf(cfg));',
    '      var mk = blocks(list);',
    '      if (state === "past" && !stop) mk += "<span class=\\"ck-ago\\">ago</span>";',
    '      setHTML(units, "units", mk);',
    '',
    '      /* The leading figure is the only one that can grow without bound: a target a few',
    '         thousand years out is a six-digit day count. Past four characters the row steps',
    '         down a size instead of wrapping or pushing the card sideways. */',
    '      var head = list.length ? group(list[0].v) : "";',
    '      setAttr("wide", "data-wide", head.length > 4 ? "on" : "off");',
    '      setAttr("state", "data-state", state === "past" && stop ? "reached" : state);',
    '',
    '      setHTML(cap, "cap", caption(state, stop));',
    '    }',
    '',
    '    /* Settings first: the tick has to have a settled config to draw from. */',
    '    CK.settings(sec, DEF, function (next) { cfg = next; render(); });',
    '',
    '    /* CK.timer rather than setInterval, and rather than CK.once around a setInterval:',
    '       once keys off the ELEMENT, and a main swap hands the builder a fresh element with an',
    '       empty dataset, so the guard passes, a second interval starts, and the first one keeps',
    '       running against a node nobody can see. The registry CK.timer keys into outlives the',
    '       DOM, so the swap replaces the interval instead of stacking another one on it. */',
    '    CK.timer(ID + ":tick", TICK, render);',
    '  });',
  ].join('\n');
}

/**
 * Assemble the browser script and refuse to return an unsafe one.
 *
 * @param id     the card's data-card value
 * @param cfg    the settled settings
 * @param target the parsed instant, or null
 * @param raw    the target as given
 * @param label  the card's subtitle
 *
 * @throws {Error} from {@link guardEmitted} when the text would break the deck
 */
function script(id, cfg, target, raw, label) {
  const src = ['(function () {', "  'use strict';", '']
    .concat(main(id, cfg, target, raw, label))
    .concat(['})();'])
    .join('\n');
  return guardEmitted(src, meta.name);
}

/**
 * Build one countdown card.
 *
 * @param id    unique on the desk; becomes data-card, the CSS scope and the settings storage key
 * @param title the card's heading
 * @param data  '{ target, label, unitsShown, past }'; unknown keys are ignored
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns '{ json, html, css, js }' — the descriptor, the markup, scoped CSS, a classic script
 *
 * @throws {Error} when the emitted script would carry syntax the deck cannot parse
 *
 * @example
 * const card = build({ id: 'ship', title: 'Release', data: { target: '2026-10-01T17:00:00Z' } });
 * card.json.target;   // 1790960400000
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'countdown' : id);
  const heading = String(title == null ? 'Countdown' : title);
  const { cfg, target, raw, label } = settle(data);
  const order = Number.isFinite(Number(ord)) ? Number(ord) : 50;

  return {
    json: {
      id: cardId, type: meta.name, title: heading, ord: order,
      target, raw, label, settings: cfg,
    },
    html: markup(cardId, heading, cfg, target, raw, label, order),
    css: styles(),
    js: script(cardId, cfg, target, raw, label),
  };
}

export default { meta, build, defaults };
