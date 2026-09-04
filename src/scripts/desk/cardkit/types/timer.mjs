/**
 * @file cardkit card type: 'timer' — a stopwatch and a pomodoro sharing one card and one clock.
 *
 * Two things about this card are load-bearing and both are about honesty rather than features.
 *
 *   1. **Elapsed time is a subtraction, never a sum.** Every value on the card comes from
 *      "now minus a stored instant". Nothing is accumulated per tick. A background tab has its
 *      intervals clamped — a second at best, minutes on a sleeping laptop — so a card that added
 *      its tick interval to a running total would quietly under-count and then present that
 *      under-count as a finished twenty-five minute session. The tick here is a repaint, not a
 *      measurement: drop a thousand of them and the next one is still right.
 *   2. **What survives a reload is the instant, not the remainder.** See {@link runShape}.
 *
 * Written without a single backtick anywhere in the file, and the browser half is built from an
 * array of lines rather than a template literal. That is not style. The whole deck's scripts are
 * concatenated into ONE inline block, so a stray backtick — in a comment, even — makes the rest of
 * the deck a template literal and blanks every card on the desk. A file with no backtick in it
 * cannot make that mistake, and {@link guardEmitted} refuses to hand back a script that did.
 *
 * @see ../CONTRACT.md — the rules this type is checked against
 * @see ../kit.js      — CK.settings, CK.timer, CK.once, CK.build
 * @see ../kit.css     — .ck-gear, .ck-set, .ck-cap and the token vocabulary
 */

/**
 * Every setting the timer understands, with the value it falls back to.
 *
 * 'work' and 'rest' are whole minutes and must each be at least one — a zero-length interval has
 * no progress to draw and no moment to end on, so the card refuses it out loud instead of
 * dividing by it. 'rounds' is how many work-plus-rest cycles make a session, where zero means no
 * limit at all and the card simply keeps cycling. 'chime' asks to be told when a phase turns; see
 * {@link CHIME_NOTE} for what the card can honestly do about that.
 *
 * These four are the settings. 'mode' and 'label' arrive in the card's data instead, because they
 * describe what the card IS rather than how this viewer wants it tuned.
 */
export const defaults = { work: 25, rest: 5, rounds: 4, chime: false };

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * 'shape' is a string on purpose — a human choosing a type reads it at a glance. 'defaults' is the
 * machine-readable half, and it is spread from {@link defaults} rather than restated so there is
 * one written source and two ways to reach it.
 *
 * @example meta.name;                  // 'timer'
 * @example Object.keys(meta.defaults); // ['work', 'rest', 'rounds', 'chime']
 */
export const meta = {
  name: 'timer',
  summary: 'Stopwatch and pomodoro in one card, timed from wall-clock instants and restored after a reload.',
  shape: '{ mode, work, rest, rounds, label } — mode "stopwatch" | "pomodoro", work and rest in whole minutes, rounds a count where 0 means no limit, label free text',
  category: 'live-and-ambient',
  defaults: { ...defaults },
};

/** The two modes. An unknown one falls back rather than blanking the card. */
const MODES = ['stopwatch', 'pomodoro'];

/**
 * The plain truth about the chime setting, said in the card rather than implied by silence.
 *
 * The desk gives a card no audio channel: the page's CSP is script-src 'self', there is no sound
 * asset to reach for, and a card that synthesised a tone would be a card reaching past its
 * sandbox. So the setting does what it can actually do — a brief emphasis of the card — and
 * says which one it is doing. A control labelled "chime" that silently means "flash" is a small
 * lie that costs someone a missed interval.
 */
const CHIME_NOTE = 'Chime flashes the card: a card has no audio channel on this desk, so it cannot make a sound.';

/** Longest interval the card will honour, in minutes — a week, which is well past absurd. */
const MAX_MIN = 10080;

/** Most rounds a session may hold. Past this the round dots stop being a picture anyway. */
const MAX_ROUNDS = 999;

/** How often the browser repaints the card. The reading does not depend on this number at all. */
const TICK_MS = 250;

/** How long the visual alert holds, in milliseconds. */
const FLASH_MS = 1400;

/**
 * A tolerance for clock wobble, in milliseconds.
 *
 * NTP nudges the system clock by tens of milliseconds routinely and that is not a clock change;
 * treating it as one would reset a running pomodoro for no reason. A jump larger than this is a
 * real change of clock and is handled as one.
 */
const SLACK_MS = 1000;

/**
 * Why the persisted run is an instant and a banked total rather than a remaining count.
 *
 * This constant exists to hold the explanation somewhere a reader will find it, because the wrong
 * version is the obvious one. Persisting "sixteen minutes left" means rewriting storage on every
 * tick, so a reload lands on whichever write happened to be last; and worse, while the tab is
 * closed nothing is ticking at all, so a session started before lunch still claims sixteen minutes
 * left an hour later. The card would be confidently wrong in exactly the situation the persistence
 * existed for.
 *
 * Storing { start, banked } needs one write per button press, is unchanged by the tab being closed
 * or the machine sleeping, and yields the elapsed time by one subtraction whenever anyone looks.
 *
 * @example runShape;   // '{ v, mode, running, start, banked }'
 */
export const runShape = '{ v, mode, running, start, banked }';

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
 * and no optional chaining, and a card title containing either would fail that check with a
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
 * @example jsObj({ work: 25 });   // '{"work":25}'
 */
function jsObj(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\?/g, '\\u003f').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Round to two places so emitted geometry stays short and diffs stay readable. */
function n2(v) { return Math.round(v * 100) / 100; }

/**
 * The progress ring's circumference, for the radius the markup draws.
 *
 * Written once and used by both halves of the card. A separate number in the stylesheet or in the
 * script would be a second source of truth for one circle, and the way that fails is silent: the
 * arc simply stops reaching all the way round and nothing errors.
 */
const ARC_CIRC = n2(2 * Math.PI * 42);

/**
 * A whole number inside a range, with a fallback for anything unreadable.
 *
 * Deliberately NOT used for 'work' and 'rest': clamping a zero up to one would silently invent an
 * interval the viewer did not ask for, and the card is supposed to refuse that case and explain
 * itself. Used for 'rounds', where zero is a legitimate meaning rather than an error.
 *
 * @param v  the configured value, possibly a string from a number input
 * @param lo the smallest value that means anything
 * @param hi the largest value worth honouring
 * @param fb what to use when the value is not a number at all
 *
 * @example clampInt('7', 0, 99, 4);    // 7
 * @example clampInt('oops', 0, 99, 4); // 4
 */
function clampInt(v, lo, hi, fb) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fb;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Fold caller-supplied data onto the defaults, keeping anything the card can honour.
 *
 * Seeding is coercive rather than strict, because a card descriptor may be a hand-edited file and
 * a typo in 'mode' should give a working stopwatch rather than an empty box. The one thing not
 * coerced is a zero or negative interval: that is passed through as-is so the browser half can
 * refuse it in front of the viewer, where the mistake is visible and fixable.
 *
 * @param data partial settings plus 'mode' and 'label'; missing and null keys keep their default
 *
 * @example settle({ mode: 'pomodoro', work: 50, rest: 10 }).rounds;   // 4
 * @example settle({ mode: 'nope' }).mode;                             // 'stopwatch'
 */
function settle(data) {
  const cfg = { ...defaults };
  const src = data && typeof data === 'object' ? data : {};

  for (const k of Object.keys(defaults)) {
    if (Object.hasOwn(src, k) && src[k] != null) cfg[k] = src[k];
  }
  /* work and rest keep whatever number they were given, including a bad one, so the refusal is
     shown rather than papered over. Only the shape is normalised. */
  cfg.work = Number.isFinite(Number(cfg.work)) ? Math.floor(Number(cfg.work)) : defaults.work;
  cfg.rest = Number.isFinite(Number(cfg.rest)) ? Math.floor(Number(cfg.rest)) : defaults.rest;
  if (cfg.work > MAX_MIN) cfg.work = MAX_MIN;
  if (cfg.rest > MAX_MIN) cfg.rest = MAX_MIN;
  cfg.rounds = clampInt(cfg.rounds, 0, MAX_ROUNDS, defaults.rounds);
  cfg.chime = !!cfg.chime;

  const mode = MODES.includes(src.mode) ? src.mode : 'stopwatch';
  const label = src.label == null ? '' : String(src.label);
  return { cfg, mode, label };
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
 * The card's markup: heading, gear, settings panel, arc, readout, controls, caption.
 *
 * The gear button is emitted empty on purpose — CK.settings fills it with a drawn gear, and a
 * glyph typed here would be a second source of truth for a shape the kit already owns. The
 * settings panel holds exactly the keys of {@link defaults}, in both directions, because the desk
 * checks that and because a control the card cannot honour is worse than a missing one.
 *
 * @param id    the card's data-card value
 * @param title the heading
 * @param cfg   the settled settings
 * @param mode  'stopwatch' or 'pomodoro'
 * @param label the card's own subtitle, or the empty string
 * @param ord   the card's position on the desk
 */
function markup(id, title, cfg, mode, label, ord) {
  const f = (name) => esc(id) + '-' + name;
  const phase = mode === 'pomodoro' ? 'work' : 'none';

  return '<section data-card="' + esc(id) + '" class="ck-timer"' +
    ' data-mode="' + esc(mode) + '" data-phase="' + phase + '"' +
    ' data-state="idle" data-wide="off" data-ord="' + esc(ord) + '">' +

    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="timer settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('work') + '">work (min)</label>' +
      '<input id="' + f('work') + '" name="work" type="number" min="1" max="' + MAX_MIN + '"' +
        ' step="1" inputmode="numeric" value="' + esc(cfg.work) + '">' +

      '<label for="' + f('rest') + '">rest (min)</label>' +
      '<input id="' + f('rest') + '" name="rest" type="number" min="1" max="' + MAX_MIN + '"' +
        ' step="1" inputmode="numeric" value="' + esc(cfg.rest) + '">' +

      '<label for="' + f('rounds') + '">rounds</label>' +
      '<input id="' + f('rounds') + '" name="rounds" type="number" min="0" max="' + MAX_ROUNDS + '"' +
        ' step="1" inputmode="numeric" value="' + esc(cfg.rounds) + '">' +

      '<label for="' + f('chime') + '">chime</label>' +
      '<input id="' + f('chime') + '" name="chime" type="checkbox"' +
        (cfg.chime ? ' checked' : '') + '>' +

      '<p class="ck-set-foot">Work, rest and rounds shape pomodoro mode only. Rounds 0 cycles ' +
        'without a limit. ' + esc(CHIME_NOTE) + '</p>' +
    '</div>' +

    '<div class="ck-body">' +
      '<svg class="ck-arc" viewBox="0 0 100 100" role="img"' +
        ' aria-label="progress through the current interval">' +
        '<circle class="ck-arc-well" cx="50" cy="50" r="42"/>' +
        '<circle class="ck-arc-run" cx="50" cy="50" r="42" transform="rotate(-90 50 50)"' +
          ' stroke-dasharray="0 ' + ARC_CIRC + '"/>' +
        /* Phase is carried by a shape as well as by a colour, because a colour alone is not a
           readable difference for everyone looking at this card. Work is a filled square; rest
           is an open ring. CSS shows exactly one of them, keyed off data-phase. */
        '<rect class="ck-mk ck-mk-work" x="42" y="42" width="16" height="16" rx="1.5"/>' +
        '<circle class="ck-mk ck-mk-rest" cx="50" cy="50" r="8"/>' +
      '</svg>' +

      '<div class="ck-read">' +
        '<div class="ck-elapsed">00:00</div>' +
        '<div class="ck-phase" aria-live="polite">' +
          '<span class="ck-phase-t">' + (mode === 'pomodoro' ? 'work' : '') + '</span>' +
        '</div>' +
        '<div class="ck-rounds"></div>' +
      '</div>' +
    '</div>' +

    '<div class="ck-ctl">' +
      '<button class="ck-go" type="button">start</button>' +
      '<button class="ck-reset" type="button">reset</button>' +
    '</div>' +

    '<div class="ck-cap">' + esc(label) + '</div>' +
  '</section>';
}

/**
 * Every rule, scoped under .ck-timer, built from tokens only.
 *
 * No literal colour appears anywhere: the desk is one document open in two viewers that want
 * opposite themes, so a hex here would be wrong in exactly one of them. prefers-color-scheme is
 * likewise untouched, because the viewer's stamped choice has to beat the operating system's.
 *
 * The one animated thing is the alert emphasis, and it is a transition rather than a keyframe
 * animation so that reduced motion can turn it into a plain static outline without losing the
 * signal. Emphasis is the message; movement was only ever the delivery.
 */
function styles() {
  return [
    '.ck-timer { position: relative; transition: box-shadow 180ms ease; }',

    /* The visual stand-in for a chime. Held for a beat, then removed. */
    '.ck-timer.ck-alert { box-shadow: 0 0 0 2px var(--accent); }',
    '@media (prefers-reduced-motion: reduce) { .ck-timer { transition: none; } }',

    '.ck-timer .ck-body { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }',

    /* min-width:0 on the readout is what stops a very long elapsed string widening the flex
       item past the card and, through it, giving the whole page a horizontal scrollbar. */
    '.ck-timer .ck-arc { flex: 0 0 auto; width: 106px; max-width: 42%; height: auto; display: block; }',
    '.ck-timer .ck-read { flex: 1 1 140px; min-width: 0; }',

    '.ck-timer .ck-arc-well { fill: var(--well); stroke: var(--rule); stroke-width: 4; }',
    '.ck-timer .ck-arc-run { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; }',
    '.ck-timer[data-phase="rest"] .ck-arc-run { stroke: var(--good); }',

    '.ck-timer .ck-mk { display: none; }',
    '.ck-timer[data-phase="work"] .ck-mk-work { display: block; }',
    '.ck-timer[data-phase="rest"] .ck-mk-rest { display: block; }',
    '.ck-timer .ck-mk-work { fill: var(--ink-dim); stroke: none; }',
    '.ck-timer .ck-mk-rest { fill: none; stroke: var(--ink-dim); stroke-width: 2.5; }',

    '.ck-timer .ck-elapsed { font: 400 30px/1.05 var(--disp); color: var(--ink);' +
      ' font-variant-numeric: tabular-nums; letter-spacing: 0.01em; overflow-wrap: anywhere; }',

    /* A run measured in days is a longer string than a run measured in minutes. Rather than let
       it wrap or clip, the readout steps down a size once it stops being short. */
    '.ck-timer[data-wide="on"] .ck-elapsed { font-size: 19px; }',

    '.ck-timer .ck-phase { margin-top: 7px; font: 700 11px/1 var(--ui); letter-spacing: 0.09em;' +
      ' text-transform: uppercase; color: var(--ink-dim); min-height: 11px; }',
    '.ck-timer[data-phase="rest"] .ck-phase { color: var(--good); }',
    '.ck-timer[data-state="refused"] .ck-elapsed { color: var(--ink-faint); }',

    '.ck-timer .ck-rounds { margin-top: 7px; display: flex; align-items: center; gap: 6px;' +
      ' flex-wrap: wrap; font: 400 11.5px/1.4 var(--ui); color: var(--ink-dim); }',
    '.ck-timer .ck-dot { display: block; width: 7px; height: 7px; border-radius: 50%;' +
      ' border: 1px solid var(--rule); }',
    '.ck-timer .ck-dot.on { background: var(--accent); border-color: var(--accent); }',
    '.ck-timer .ck-dot.now { border-color: var(--accent); border-width: 2px; }',

    '.ck-timer .ck-ctl { display: flex; gap: 8px; margin-top: 12px; }',
    '.ck-timer .ck-ctl button { font: 400 12px/1 var(--ui); color: var(--ink);' +
      ' background: var(--pill); border: 1px solid var(--pill-edge); border-radius: 5px;' +
      ' padding: 7px 13px; cursor: pointer; }',
    '.ck-timer .ck-ctl button:hover { border-color: var(--accent); color: var(--accent); }',
    '.ck-timer .ck-ctl button[disabled] { opacity: 0.45; cursor: default; }',

    /* A stopwatch has no phase and no rounds; hiding them is honest, dimming them is not. */
    '.ck-timer[data-mode="stopwatch"] .ck-phase { display: none; }',
    '.ck-timer[data-mode="stopwatch"] .ck-rounds { display: none; }',

    /* kit.css stretches settings fields to their cell; a stretched checkbox is a wide hit area
       with a glyph adrift in it, so this one control opts out. */
    '.ck-timer .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',

    '.ck-timer .ck-cap { overflow-wrap: anywhere; }',
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
 * @example guardEmitted('var a = 1;', 'timer');   // 'var a = 1;'
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
 * The card's browser half: storage, the derivation, the controls, the alert.
 *
 * Written as an array of lines rather than a template literal, so no backtick can exist in this
 * file at all and therefore none can reach the emitted script. Everything is wrapped in an IIFE by
 * {@link script}, because a desk can hold two timer cards and a top-level var would have them
 * sharing state.
 *
 * @param id    the card's data-card value, embedded as a literal
 * @param cfg   the settled settings this card starts from
 * @param mode  'stopwatch' or 'pomodoro'
 * @param label the card's subtitle, or the empty string
 *
 * @example main('t1', defaults, 'pomodoro', '').indexOf('CK.build') > 0;   // true
 */
function main(id, cfg, mode, label) {
  return [
    '  var ID      = ' + jsStr(id) + ';',
    '  var MODE    = ' + jsStr(mode) + ';',
    '  var LABEL   = ' + jsStr(label) + ';',
    '  var DEF     = ' + jsObj(cfg) + ';',
    '  var KEY     = "desk.timer." + ID;',
    '  var TICK    = ' + TICK_MS + ';',
    '  var FLASH   = ' + FLASH_MS + ';',
    '  var SLACK   = ' + SLACK_MS + ';',
    '  var MAXMIN  = ' + MAX_MIN + ';',
    '  var MAXRND  = ' + MAX_ROUNDS + ';',
    '  var CIRC    = ' + ARC_CIRC + ';',
    '  var CHIMSG  = ' + jsStr(CHIME_NOTE) + ';',
    '',
    '  /* A local copy of CK.esc, so the caption cannot become an injection point even if the',
    '     kit is ever loaded in a reduced form on some other desk. */',
    '  function esc(s) {',
    '    return String(s == null ? "" : s)',
    '      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")',
    '      .replace(/"/g, "&quot;").replace(/\'/g, "&#39;");',
    '  }',
    '',
    '  function pad2(v) { return (v < 10 ? "0" : "") + v; }',
    '',
    '  /* Thousand separators, hand-rolled. toLocaleString would group by the viewer locale, and',
    '     this number sits against a fixed-width HH:MM:SS that should not change shape by region. */',
    '  function group(n) {',
    '    var s = String(n), out = "", i = s.length;',
    '    while (i > 3) { out = "," + s.slice(i - 3, i) + out; i -= 3; }',
    '    return s.slice(0, i) + out;',
    '  }',
    '',
    '  /* A duration as text. Days appear only once there are days, so a two-minute stopwatch is',
    '     not padded out with zeroes it has not earned, and a run left going over a long weekend',
    '     reads as "2d 14:03:11" rather than as 62 hours or as an overflowing line. */',
    '  function dur(ms) {',
    '    var t = Math.floor((ms > 0 ? ms : 0) / 1000);',
    '    var d = Math.floor(t / 86400);',
    '    var h = Math.floor(t / 3600) % 24;',
    '    var m = Math.floor(t / 60) % 60;',
    '    var s = t % 60;',
    '    if (d > 0) return group(d) + "d " + pad2(h) + ":" + pad2(m) + ":" + pad2(s);',
    '    if (h > 0) return pad2(h) + ":" + pad2(m) + ":" + pad2(s);',
    '    return pad2(m) + ":" + pad2(s);',
    '  }',
    '',
    '  /* A whole number, or the fallback. Used for rounds, where 0 is a real meaning; NOT used',
    '     for work and rest, where a 0 has to reach the viewer as a refusal rather than be',
    '     quietly rounded up into an interval nobody asked for. */',
    '  function whole(v, fb) {',
    '    var n = Math.floor(Number(v));',
    '    return isFinite(n) ? n : fb;',
    '  }',
    '',
    '  function store() { try { return window.localStorage || null; } catch (e) { return null; } }',
    '',
    '  function blank() { return { running: false, start: 0, banked: 0 }; }',
    '',
    '  /* The run is persisted as an INSTANT plus a banked total, never as a remaining count.',
    '     A remaining count has to be rewritten on every tick, so a reload lands on whichever',
    '     write happened to be last; and while the tab is shut nothing is counting at all, so a',
    '     session started before lunch would still claim sixteen minutes left an hour later —',
    '     confidently wrong in exactly the situation the persistence was added for. An instant',
    '     needs one write per button press and is still true after the machine has slept. */',
    '  function save(st) {',
    '    var s = store();',
    '    if (!s) return;',
    '    try {',
    '      s.setItem(KEY, JSON.stringify({ v: 1, mode: MODE, running: !!st.running,',
    '                                      start: st.start, banked: st.banked }));',
    '    } catch (e) { /* private window: the timer still runs, it just will not outlive the tab */ }',
    '  }',
    '',
    '  /* Read the run back distrusting every field: this is a text file the viewer can open and',
    '     edit, so a string where a number belongs, or a start instant sitting in next week, has',
    '     to produce a working card and an explanation rather than a display of nonsense. */',
    '  function load(now) {',
    '    var s = store(), raw = null, o = null;',
    '    if (!s) return { st: blank(), warn: "" };',
    '    try { raw = s.getItem(KEY); } catch (e) { return { st: blank(), warn: "" }; }',
    '    if (!raw) return { st: blank(), warn: "" };',
    '    try { o = JSON.parse(raw); } catch (e) { return { st: blank(), warn: "stored" }; }',
    '    if (!o || typeof o !== "object") return { st: blank(), warn: "stored" };',
    '    if (o.mode !== MODE) return { st: blank(), warn: "" };',
    '    var start = Number(o.start), banked = Number(o.banked);',
    '    if (!isFinite(start) || !isFinite(banked) || start < 0 || banked < 0 || banked > 1e14) {',
    '      return { st: blank(), warn: "stored" };',
    '    }',
    '    var st = { running: !!o.running, start: start, banked: banked };',
    '    /* A stored start ahead of the clock cannot be a start: it means the device clock moved,',
    '       or the file was edited. Either way the run is not measurable, so it is dropped and',
    '       the caption says so rather than showing a negative or a plausible wrong number. */',
    '    if (st.running && start - now > SLACK) return { st: blank(), warn: "future" };',
    '    return { st: st, warn: "" };',
    '  }',
    '',
    '  CK.build(ID, function (sec) {',
    '',
    '    var out   = sec.querySelector(".ck-elapsed"),',
    '        arc   = sec.querySelector(".ck-arc-run"),',
    '        ptext = sec.querySelector(".ck-phase-t"),',
    '        rnds  = sec.querySelector(".ck-rounds"),',
    '        cap   = sec.querySelector(".ck-cap"),',
    '        go    = sec.querySelector(".ck-go"),',
    '        rst   = sec.querySelector(".ck-reset");',
    '',
    '    var boot   = load(Date.now());',
    '    var st     = boot.st;',
    '    var warn   = boot.warn;',
    '    var cfg    = null;',
    '    var lastKey = null;',
    '    var alertT = 0;',
    '    var last   = { txt: "", phase: "", rounds: "", cap: "", go: "", state: "" };',
    '',
    '    /* Elapsed is a SUBTRACTION and never a sum. Nothing on this card is accumulated per',
    '       tick, because a background tab has its intervals clamped to a second at best and to',
    '       nothing at all while the machine sleeps — so a card adding its tick interval to a',
    '       running total would under-count by minutes across a lunch break and then present',
    '       that under-count as a finished twenty-five minute session. Storing the instant makes',
    '       the tick a repaint rather than a measurement: miss a thousand of them and the next',
    '       one still shows the truth. */',
    '    function elapsed(now) {',
    '      if (!st.running) return st.banked;',
    '      var d = now - st.start;',
    '      if (d < 0) d = 0;',
    '      return st.banked + d;',
    '    }',
    '',
    '    /* Everything the card shows for one instant, derived rather than remembered.',
    '',
    '       The pomodoro phase and round come out of the total elapsed by division, not out of a',
    '       counter advanced at each transition. Same discipline as the readout and it matters',
    '       for the same reason: a tab hidden through two whole intervals gets its next tick in',
    '       the right phase of the right round, because nothing was ever counting transitions. */',
    '    function plan(now) {',
    '      var e = elapsed(now);',
    '      var v = { e: e, frac: 0, phase: "none", round: 0, rounds: 0, done: false, bad: "" };',
    '',
    '      if (MODE !== "pomodoro") {',
    '        v.frac = (e % 60000) / 60000;',
    '        return v;',
    '      }',
    '',
    '      var wm = whole(cfg.work, 0), rm = whole(cfg.rest, 0);',
    '      if (wm > MAXMIN) wm = MAXMIN;',
    '      if (rm > MAXMIN) rm = MAXMIN;',
    '      /* A zero-length interval has no progress to draw and no moment to end on. Refused in',
    '         front of the viewer, with the arc left at zero: nothing is divided here. */',
    '      if (wm < 1 || rm < 1) {',
    '        v.bad = "work and rest must each be at least one minute";',
    '        return v;',
    '      }',
    '',
    '      var n = whole(cfg.rounds, 0);',
    '      if (n < 0) n = 0;',
    '      if (n > MAXRND) n = MAXRND;',
    '      v.rounds = n;',
    '',
    '      var w = wm * 60000, r = rm * 60000, cyc = w + r;',
    '      if (n > 0 && e >= n * cyc) {',
    '        v.done = true; v.round = n; v.phase = "rest"; v.frac = 1; v.e = n * cyc;',
    '        return v;',
    '      }',
    '',
    '      var k = Math.floor(e / cyc), into = e - k * cyc;',
    '      v.round = k + 1;',
    '      if (into < w) { v.phase = "work"; v.frac = into / w; }',
    '      else { v.phase = "rest"; v.frac = (into - w) / r; }',
    '      return v;',
    '    }',
    '',
    '    /* The stand-in for a chime. A brief emphasis of the whole card, removed again on a',
    '       timeout; under reduced motion the CSS drops the transition and it becomes a plain',
    '       outline held for the same beat, which is the same signal without the movement. */',
    '    function flash() {',
    '      if (!sec.classList) return;',
    '      sec.classList.add("ck-alert");',
    '      clearTimeout(alertT);',
    '      alertT = setTimeout(function () { sec.classList.remove("ck-alert"); }, FLASH);',
    '    }',
    '',
    '    function setText(el, key, val) {',
    '      if (last[key] === val) return;',
    '      last[key] = val;',
    '      if (el) el.textContent = val;',
    '    }',
    '',
    '    function roundsMarkup(v) {',
    '      if (MODE !== "pomodoro" || v.bad) return "";',
    '      var text = v.done ? ("all " + v.rounds + " rounds done")',
    '               : v.rounds > 0 ? ("round " + v.round + " of " + v.rounds)',
    '               : ("round " + v.round + ", no limit");',
    '      var dots = "", i, cls;',
    '      /* Past a dozen the dots stop being a picture and start being a wall, so the count',
    '         carries it alone. */',
    '      if (v.rounds > 0 && v.rounds <= 12) {',
    '        for (i = 1; i <= v.rounds; i++) {',
    '          cls = (v.done || i < v.round) ? " on" : (i === v.round ? " now" : "");',
    '          dots += "<i class=\\"ck-dot" + cls + "\\"></i>";',
    '        }',
    '      }',
    '      return "<span>" + esc(text) + "</span>" + dots;',
    '    }',
    '',
    '    function caption(v) {',
    '      var bits = [];',
    '      if (LABEL) bits.push("<b>" + esc(LABEL) + "</b>");',
    '      if (MODE === "pomodoro") {',
    '        bits.push("<i>pomodoro " + esc(whole(cfg.work, 0)) + " + " + esc(whole(cfg.rest, 0)) +',
    '                  " min" + (v.rounds > 0 ? (", " + v.rounds + " rounds") : ", no round limit") + "</i>");',
    '      } else {',
    '        bits.push("<i>stopwatch; the ring sweeps the current minute</i>");',
    '      }',
    '      if (v.bad) {',
    '        bits.push("<span class=\\"ck-aside\\">" + esc(v.bad) +',
    '                  ", so this session will not start</span>");',
    '      }',
    '      if (warn === "future") {',
    '        bits.push("<span class=\\"ck-aside\\">the saved start was ahead of this device clock, " +',
    '                  "so the clock changed and the run was reset</span>");',
    '      }',
    '      if (warn === "back") {',
    '        bits.push("<span class=\\"ck-aside\\">the device clock moved backwards, so the run was " +',
    '                  "reset rather than reported wrong</span>");',
    '      }',
    '      if (warn === "stored") {',
    '        bits.push("<span class=\\"ck-aside\\">the saved run could not be read, so this starts " +',
    '                  "from zero</span>");',
    '      }',
    '      if (cfg.chime) bits.push("<span class=\\"ck-aside\\">" + esc(CHIMSG) + "</span>");',
    '      return bits.join(" ");',
    '    }',
    '',
    '    function render() {',
    '      if (!cfg) return;',
    '      var now = Date.now();',
    '',
    '      /* A start instant ahead of the clock means the clock moved, not that time did.',
    '         Carrying on would show a negative elapsed or, worse, a plausible wrong one. */',
    '      if (st.running && st.start - now > SLACK) {',
    '        st = blank(); warn = "back"; lastKey = null; save(st);',
    '      }',
    '',
    '      var v = plan(now);',
    '',
    '      /* Finishing banks the exact session length, so the frozen readout is the session and',
    '         not whenever the last tick happened to land. */',
    '      if (v.done && st.running) {',
    '        st.running = false; st.start = 0; st.banked = v.e; save(st);',
    '      }',
    '',
    '      var txt = dur(v.e);',
    '      setText(out, "txt", txt);',
    '      sec.setAttribute("data-wide", txt.length > 8 ? "on" : "off");',
    '',
    '      var f = v.frac;',
    '      if (!isFinite(f) || f < 0) f = 0;',
    '      if (f > 1) f = 1;',
    '      if (arc) {',
    '        arc.setAttribute("stroke-dasharray",',
    '                         (Math.round(CIRC * f * 100) / 100) + " " + CIRC);',
    '      }',
    '',
    '      sec.setAttribute("data-phase", MODE === "pomodoro" && !v.bad ? v.phase : "none");',
    '      setText(ptext, "phase", MODE === "pomodoro" && !v.bad ? v.phase : "");',
    '',
    '      var rm = roundsMarkup(v);',
    '      if (rm !== last.rounds) { last.rounds = rm; if (rnds) rnds.innerHTML = rm; }',
    '',
    '      var state = v.bad ? "refused" : v.done ? "done"',
    '                : st.running ? "running" : (st.banked > 0 ? "paused" : "idle");',
    '      if (state !== last.state) { last.state = state; sec.setAttribute("data-state", state); }',
    '',
    '      var glabel = v.bad ? "start" : v.done ? "restart" : st.running ? "pause"',
    '                 : (st.banked > 0 ? "resume" : "start");',
    '      setText(go, "go", glabel);',
    '      if (go) go.disabled = !!v.bad;',
    '',
    '      var c = caption(v);',
    '      if (c !== last.cap) { last.cap = c; if (cap) cap.innerHTML = c; }',
    '',
    '      /* One key for "which interval of which round are we in". When it changes, an interval',
    '         turned over. The first render after a build only establishes the baseline, so a',
    '         page swap cannot flash a card at someone for standing still. */',
    '      var key = MODE === "pomodoro"',
    '              ? (v.bad ? "bad" : v.done ? "done" : v.phase + ":" + v.round) : "";',
    '      if (lastKey === null) lastKey = key;',
    '      else if (key !== lastKey) { lastKey = key; if (cfg.chime) flash(); }',
    '    }',
    '',
    '    function toggle() {',
    '      var now = Date.now();',
    '      var v = plan(now);',
    '      if (v.bad) return;',
    '      if (v.done) { st = blank(); st.running = true; st.start = now; }',
    '      else if (st.running) { st.banked = elapsed(now); st.running = false; st.start = 0; }',
    '      else { st.start = now; st.running = true; }',
    '      warn = ""; lastKey = null;',
    '      save(st);',
    '      render();',
    '    }',
    '',
    '    function reset() {',
    '      st = blank(); warn = ""; lastKey = null;',
    '      save(st);',
    '      render();',
    '    }',
    '',
    '    /* Settings first: the tick has to have a settled config to draw from. */',
    '    CK.settings(sec, DEF, function (next) { cfg = next; lastKey = null; render(); });',
    '',
    '    /* once keys off the element, and a swap hands over a brand new button with an empty',
    '       dataset, so this attaches exactly one listener to whichever button is live. */',
    '    CK.once(go, "go", function () { go.addEventListener("click", toggle); });',
    '    CK.once(rst, "reset", function () { rst.addEventListener("click", reset); });',
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
 * @param id    the card's data-card value
 * @param cfg   the settled settings
 * @param mode  'stopwatch' or 'pomodoro'
 * @param label the card's subtitle
 *
 * @throws {Error} from {@link guardEmitted} when the text would break the deck
 */
function script(id, cfg, mode, label) {
  const src = ['(function () {', "  'use strict';", '']
    .concat(main(id, cfg, mode, label))
    .concat(['})();'])
    .join('\n');
  return guardEmitted(src, meta.name);
}

/**
 * Build one timer card.
 *
 * @param id    unique on the desk; becomes data-card, the CSS scope and both storage keys
 * @param title the card's heading
 * @param data  '{ mode, work, rest, rounds, label }'; unknown keys are ignored
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns '{ json, html, css, js }' — the descriptor, the markup, scoped CSS, a classic script
 *
 * @throws {Error} when the emitted script would carry syntax the deck cannot parse
 *
 * @example
 * const card = build({ id: 'pom', title: 'Focus', data: { mode: 'pomodoro', work: 50, rest: 10 } });
 * card.json.mode;   // 'pomodoro'
 *
 * @see meta
 * @see runShape
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'timer' : id);
  const heading = String(title == null ? 'Timer' : title);
  const { cfg, mode, label } = settle(data);
  const order = Number.isFinite(Number(ord)) ? Number(ord) : 50;

  return {
    json: { id: cardId, type: meta.name, title: heading, ord: order, mode, label, settings: cfg },
    html: markup(cardId, heading, cfg, mode, label, order),
    css: styles(),
    js: script(cardId, cfg, mode, label),
  };
}

export default { meta, build, defaults, runShape };
