/**
 * `capacity` -- one row per person, committed against what that person actually has.
 *
 * **Why this is not `bullet`.** It nearly is, and the question was taken seriously enough to be
 * answered in code rather than in prose. `bullet` draws a measure against a target on a scale it
 * shares with every other bullet in the multiple, and that shared ABSOLUTE scale is exactly what
 * makes it the wrong instrument here:
 *
 *   1. **The reference moves per row.** Ana has forty hours and Ben has twelve. On a bullet chart
 *      their target ticks land at different places along the track, so "who is over" cannot be
 *      read by scanning down a column -- the eye has to compare each bar to its own tick, one row
 *      at a time. This card normalises every row to that person's own hundred per cent, so the
 *      reference is ONE vertical rule down the whole card and over-allocation is a straight visual
 *      scan. That is not a restyled bullet; it is the opposite scale choice.
 *   2. **The team total is a different question.** A team can be over-committed while every
 *      individual is under, and vice versa, and `bullet` has no place to put either answer: its
 *      caption speaks per bullet plus one sentence about the shared scale. The aggregate here is
 *      its own row on the same rule, and the caption says explicitly when the two answers disagree.
 *   3. **Unstated is not zero.** `bullet` has one way to say "no target", so a person whose
 *      availability nobody recorded and a person whose availability is genuinely zero come out
 *      identical. They are opposite facts: the first means we do not know, the second means any
 *      commitment at all is over-commitment. Both are drawn differently here and counted apart.
 *
 * Where none of those three matter -- absolute hours against a target, on one scale, no aggregate
 * -- `bullet` is the better card and this one should not be used. That is not false modesty; it is
 * the boundary that keeps the catalogue from growing two names for one picture.
 *
 * **Over-allocation is drawn as over-allocation.** The bar runs past the hundred-per-cent rule
 * into the overflow lane rather than being clipped to a full track, because a bar that stops at
 * the end says "exactly at capacity" and that is the single most useful thing a capacity chart can
 * fail to say. Past the end of the drawing -- four times availability -- the bar is cut with a
 * chevron and the readout carries the true figure, which is the only honest thing left to do with
 * a number that will not fit.
 *
 * Colour never carries the meaning. Over-allocation is three signals at once: it is past the rule
 * (position), it is hatched (texture), and the readout says "over by 34%" in words. Any one of
 * them alone would be enough.
 *
 * Everything is rendered here, in Node, escaped. The browser half reorders and hides elements that
 * already exist; it never builds one.
 *
 * @see ./bullet.mjs   -- the measure-against-target card this deliberately is not
 * @see ./ledger.mjs   -- the row-oriented idiom this follows
 * @see ../CONTRACT.md -- `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so `CK.scale`, `CK.ticks`, `CK.fmt` and `CK.esc`
 * are the same implementations the browser has rather than four private copies that drift.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().scale([0, 2], [0, 400])(1);   // 200
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/capacity: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/capacity: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Declared before {@link meta} and spread into it, so there is one written source and two places
 * to read it.
 *
 * `sort` is offered here where `raci` refuses it, and the difference is real: a RACI grid's row
 * order is the order of the plan and means something, while a roster's order means nothing at all
 * and sorting by load is how a reader finds the person in trouble.
 *
 * @example defaults.sort;   // 'given'
 */
export const defaults = {
  sort:     'given',
  absolute: true,
  dense:    false,
};

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * @example meta.name;   // 'capacity'
 */
export const meta = {
  name: 'capacity',
  summary:
    'One row per person, committed against their own availability on a shared hundred-per-cent ' +
    'rule, with over-allocation drawn past the rule rather than clipped and a team total that ' +
    'answers a different question from any individual row.',
  shape:
    '{ people: [{ id, label, committed, available, note }], unit, period } -- ' +
    'committed and available are amounts in the same unit; an absent available means nobody ' +
    'stated one and is kept apart from an available of zero; a negative or unparseable amount is ' +
    'refused, counted and named rather than coerced',
  category: 'work-and-lists',
  defaults: { ...defaults },
};

/* -- the build-time guard ----------------------------------------------------------------- */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for `const`, `let` and `class` false-positives on English prose -- one card in this
 * catalogue was refused because a comment said "the class is what CSS reads" -- and a guard that
 * cries wolf is a guard somebody switches off. Regex literals are recognised, because otherwise
 * the scanner desynchronises on the quote inside a `replace` call and starts blanking real code.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').indexOf('const');   // -1
 */
export function blankNonCode(src) {
  const out = src.split('');
  let i = 0;
  let prev = '';
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      blank(i, end); i = end; continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      blank(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    if (c === '/' && !/[\w)\]]/.test(prev)) {
      let k = i + 1;
      let cls = false;
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
 * Refuse to emit browser script that would break the whole desk, and say exactly where.
 *
 * Every card's `js` is concatenated into ONE inline block, so a single backtick closes the
 * surrounding template literal early and blanks every card on the page. The backtick is never
 * written in this file; it is reached for as `String.fromCharCode(96)`.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/capacity';
  const near = (at) => src.slice(Math.max(0, at - 45), at + 45);
  const die = (what, at) => {
    throw new Error(where + ': emitted js ' + what + ' at offset ' + at + ' - near: ' + near(at));
  };

  const tick = src.indexOf(String.fromCharCode(96));
  if (tick >= 0) die('contains a backtick', tick);

  const arrow = src.indexOf(String.fromCharCode(61) + String.fromCharCode(62));
  if (arrow >= 0) die('contains an arrow function', arrow);

  const opt = src.indexOf(String.fromCharCode(63) + String.fromCharCode(46));
  if (opt >= 0) die('contains optional chaining', opt);

  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) die('contains control character ' + c, i);
  }

  const code = blankNonCode(src);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) die('declares ' + kw, m.index);
  }

  return src;
}

/* -- constants ---------------------------------------------------------------------------- */

/** The drawing's width in viewBox units. Rows and ruler share it so their x positions line up. */
const VB = 400;

/**
 * The furthest the track will ever reach, as a multiple of availability.
 *
 * Four is a judgement and it is stated in the caption. Past it the bar is cut with a chevron and
 * the readout carries the real number: a bar that keeps growing turns every other row into a
 * hairline, and a row nobody can read is a row that has stopped being drawn.
 */
const CAP = 4;

/** The least the track will ever reach, so a card where nobody is over still has room past the rule. */
const FLOOR = 1.25;

/** Person labels are clipped to this many characters; the full text survives in `title`. */
const LABEL_CHARS = 40;

/** How many names a caption lists before it stops naming and starts counting. */
const NAME_CAP = 4;

/** The most hatch ticks one overflow bar draws, so three hundred rows stay a few thousand nodes. */
const HATCH_MAX = 16;

/* -- reading the data --------------------------------------------------------------------- */

/**
 * Drop C0 control characters and DEL from a caller's text, keeping nothing invisible.
 *
 * Code-point arithmetic rather than a character class, per contract rule 6: a class has to be
 * spelled with escapes, and an escape decoded one step too early puts a raw control character
 * into this file where it is invisible in every editor and survives `node --check`. DEL goes too,
 * because `JSON.stringify` does not escape it.
 *
 * @param s the text to clean
 *
 * @example clean('a\u0000b').length;   // 2
 */
function clean(s) {
  let out = '';
  const raw = String(s == null ? '' : s);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 32 || c === 127) continue;
    out += raw.charAt(i);
  }
  return out;
}

/** Shorten a string to `max` characters, keeping the head and marking the cut. */
function clip(s, max) {
  const str = String(s);
  return str.length <= max ? str : str.slice(0, Math.max(1, max - 1)) + '\u2026';
}

/**
 * An amount, told apart from the two ways an amount can be absent and the two ways it can be wrong.
 *
 * Five answers rather than a number, because a capacity card that folds them together is a
 * capacity card that lies:
 *
 *   - `{ have: true, value }` -- a real, finite, non-negative amount. Zero is one of these.
 *   - `{ have: false, missing: true }` -- nobody said. Not zero.
 *   - `{ have: false, bad: 'soon' }` -- something was said and it is not a number.
 *   - `{ have: false, bad: '-4', negative: true }` -- a negative amount, refused. There is no such
 *     thing as minus four hours of commitment, and coercing it to zero would quietly hand somebody
 *     back four hours of capacity they do not have.
 *
 * @param v the caller's value
 * @returns the discrimination above
 *
 * @example amount(0).have;        // true
 * @example amount(null).missing;  // true
 * @example amount(-1).negative;   // true
 */
function amount(v) {
  if (v == null) return { have: false, missing: true, negative: false, bad: '' };
  if (typeof v === 'boolean') return { have: false, missing: false, negative: false, bad: String(v) };
  const s = typeof v === 'string' ? clean(v).trim() : v;
  if (s === '') return { have: false, missing: true, negative: false, bad: '' };
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { have: false, missing: false, negative: false, bad: clip(String(s), 20) };
  }
  if (n < 0) return { have: false, missing: false, negative: true, bad: clip(String(n), 20) };
  return { have: true, missing: false, negative: false, bad: '', value: n };
}

/**
 * One person, folded into the shape the renderer may assume, with a decided state.
 *
 * The four states are the four honest readings and they are decided once, here, so that no part of
 * the drawing or the caption has to re-derive them and risk deciding differently:
 *
 *   - `ok`       -- availability above zero, so a ratio exists.
 *   - `zero`     -- availability of exactly zero. A ratio does not exist and never will; any
 *                   commitment at all is over-commitment, which is a stronger statement than any
 *                   percentage and is made in words rather than as a division by zero.
 *   - `unstated` -- nobody recorded an availability. There is no denominator and inventing one
 *                   would be making the answer up.
 *   - `refused`  -- something was recorded and it is not usable. Counted and named, never coerced.
 *
 * @param raw   the caller's person, entirely untrusted
 * @param unit  the card-level unit, used when the person carries none
 * @param index the person's position in the roster, which is the tiebreak in every ordering
 *
 * @example readOne({ label: 'Ana', committed: 36, available: 40 }, 'h', 0).ratio;   // 0.9
 */
function readOne(raw, unit, index) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const com = amount(r.committed);
  const av = amount(r.available);

  const bad = [];
  if (com.negative) bad.push('a negative commitment of ' + com.bad);
  else if (com.bad) bad.push('a commitment of ' + com.bad + ', which is not a number');
  if (av.negative) bad.push('a negative availability of ' + av.bad);
  else if (av.bad) bad.push('an availability of ' + av.bad + ', which is not a number');

  let state;
  if (bad.length) state = 'refused';
  else if (av.missing) state = 'unstated';
  else if (av.value === 0) state = 'zero';
  else state = 'ok';

  const committed = com.have ? com.value : 0;
  const available = av.have ? av.value : 0;
  const ratio = state === 'ok' ? committed / available : null;

  return {
    index,
    id: r.id == null ? '' : clean(r.id),
    label: r.label == null ? '' : clean(r.label),
    note: r.note == null ? '' : clean(r.note),
    unit: clip(clean(r.unit == null ? unit : r.unit).trim(), 12),
    state,
    bad,
    committed,
    hasCommitted: com.have,
    committedMissing: com.missing,
    available,
    ratio,
  };
}

/**
 * Normalise whatever arrived into the payload the renderer takes, including the shared scale.
 *
 * The scale is the decision that makes this card what it is. It is a RATIO scale, not an amount
 * scale: every row's own availability is one, so the hundred-per-cent rule is a single vertical
 * line down the whole card and "who is over" is a scan rather than a per-row comparison. It runs
 * from zero to whichever is larger of {@link FLOOR} and the biggest ratio present, capped at
 * {@link CAP} so one person at twelve times capacity cannot flatten everyone else to a hairline.
 *
 * @param data the card's `data` block, possibly absent, an array, or one person
 * @returns `{ people, hi, unit, period, team, ... }`
 *
 * @example readData({ people: [{ label: 'a', committed: 1, available: 2 }] }).people[0].ratio;   // 0.5
 * @example readData(undefined).people.length;                                                    // 0
 */
function readData(data) {
  const isArr = Array.isArray(data);
  const d = !isArr && data && typeof data === 'object' ? data : {};
  const unit = d.unit == null ? '' : clean(d.unit).trim();
  const period = d.period == null ? '' : clip(clean(d.period).trim(), 40);

  const src = isArr ? data : Array.isArray(d.people) ? d.people : [];
  const seen = new Set();
  const people = [];
  let dupes = 0;
  let auto = 0;

  for (const raw of src) {
    const p = readOne(raw, unit, people.length);
    let id = p.id;
    if (id === '') { do { id = 'p' + (++auto); } while (seen.has(id)); }
    if (seen.has(id)) { dupes++; continue; }
    seen.add(id);
    p.id = id;
    if (p.label === '') p.label = id;
    p.index = people.length;
    people.push(p);
  }

  let maxRatio = 0;
  for (const p of people) if (p.ratio !== null && p.ratio > maxRatio) maxRatio = p.ratio;
  const hi = Math.min(CAP, Math.max(FLOOR, maxRatio * 1.04));

  /* The team figure is the sum of the numerators over the sum of the denominators, and NOT the
     mean of the per-person ratios. The two differ whenever people have different availabilities,
     and only the first answers the question "does the team have the hours". A mean of ratios
     answers "is the average person busy", which is a question nobody asked and which a single
     part-timer at 300% can dominate. */
  let teamCommitted = 0;
  let teamAvailable = 0;
  let outsideUnstated = 0;
  let outsideZero = 0;
  for (const p of people) {
    if (p.state === 'ok') { teamCommitted += p.committed; teamAvailable += p.available; }
    else if (p.state === 'unstated') outsideUnstated += p.committed;
    else if (p.state === 'zero') outsideZero += p.committed;
  }

  return {
    people, hi, unit, period, dupes,
    team: {
      committed: teamCommitted,
      available: teamAvailable,
      ratio: teamAvailable > 0 ? teamCommitted / teamAvailable : null,
      counted: people.filter((p) => p.state === 'ok').length,
      /* Kept apart rather than summed. The two are outside the team figure for opposite reasons --
         one because nobody wrote a denominator down and one because the denominator is genuinely
         nothing -- and a caption that attributed the whole sum to either would be wrong. */
      outsideUnstated,
      outsideZero,
      outsideCommitted: outsideUnstated + outsideZero,
    },
  };
}

/* -- geometry ----------------------------------------------------------------------------- */

/**
 * Round to two decimals, refusing to emit a coordinate that is not a number.
 *
 * A `NaN` in an SVG attribute is silent: the browser drops the attribute and the card draws wrong
 * with nothing in the console. Failing at build time turns that into a stack trace next to the
 * input that caused it.
 *
 * @param v    the number
 * @param what a short name for the caller, so the message says which one went wrong
 * @throws {Error} when `v` is NaN or infinite
 *
 * @example n2(0.3333, 'width');   // 0.33
 */
function n2(v, what) {
  if (!Number.isFinite(v)) {
    throw new Error('cardkit/capacity: non-finite value from ' + (what || 'geometry') + ' (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/**
 * The number a reader sees, in the card's unit.
 *
 * Through `CK.fmt`, which is the desk's own compact format, so a capacity card and a chart on the
 * same desk print 1.2k the same way.
 *
 * @example fmtAmount(36, 'h');   // '36 h'
 */
function fmtAmount(v, unit) { return CK.fmt(v) + (unit ? ' ' + unit : ''); }

/** A ratio as a whole-number percentage, never `NaN`. */
function pctOf(r) { return Number.isFinite(r) ? Math.round(r * 100) : 0; }

/* -- emit --------------------------------------------------------------------------------- */

/** The card's id as it may appear inside a double-quoted CSS attribute selector. */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/**
 * A JavaScript literal safe to paste into an inline `<script>`.
 *
 * `<` and `>` become escapes so a value containing a closing script tag cannot end the block
 * early, with the side effect that no value can spell an arrow. The QUESTION MARK is escaped
 * because a caller string containing `?.` is optional chaining as far as a raw scan is concerned,
 * so the card's own guard would refuse the build over a rule the card did not break.
 *
 * @example jsLit('a?.b');   // '"a\\u003f.b"'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(new RegExp(String.fromCharCode(96), 'g'), '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-capacity[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour; every value is a desk token, so the light switch is the only thing
 * that has to know anything and the card is correct in a theme it was never opened in.
 *
 * The row is a three-column grid, and that has a consequence worth writing down: a grid container
 * does not render whitespace-only text nodes between its children, so a space written BETWEEN two
 * spans is invisible in the flattened text a screen reader and a clipboard receive. Every text
 * span in a row therefore carries its own trailing space inside itself.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-cp-h3', 'margin: 14px 0 4px;'],

    ['.ck-cp-row',
     'display: grid; grid-template-columns: minmax(0, 11em) 1fr minmax(0, 13em); ' +
     'align-items: center; gap: 0 10px; padding: 5px 2px; ' +
     'border-bottom: 1px solid var(--hairline);'],
    ['.ck-capacity.ck-cp-dense .ck-cp-row', 'padding: 1px 2px;'],
    ['.ck-cp-row[hidden]', 'display: none;'],
    ['.ck-cp-row:hover', 'background: var(--pill);'],

    ['.ck-cp-lab',
     'font-size: 12px; color: var(--ink); overflow: hidden; ' +
     'text-overflow: ellipsis; white-space: nowrap;'],

    ['svg.ck-cp-track', 'display: block; width: 100%; height: 13px;'],
    ['.ck-capacity.ck-cp-dense svg.ck-cp-track', 'height: 9px;'],
    ['svg.ck-cp-ruler', 'display: block; width: 100%; height: auto;'],
    ['svg.ck-cp-ruler text', 'font-family: var(--mono); font-size: 12px; fill: var(--ink-faint);'],

    ['.ck-cp-base', 'fill: var(--well);'],
    ['.ck-cp-under', 'fill: var(--good);'],
    ['.ck-cp-stub', 'fill: var(--ink-faint);'],

    /* Over-allocation is past the rule, hatched, and named in the readout. Three channels, so a
       reader who sees no colour at all still gets the fact twice. */
    ['.ck-cp-over', 'fill: var(--ck-s1);'],
    ['.ck-cp-hatch', 'stroke: var(--ground); stroke-width: 1.6; fill: none;'],
    ['.ck-cp-clipmark', 'stroke: var(--ck-s1); stroke-width: 2; fill: none; stroke-linecap: round;'],

    /* The one reference every row shares. Solid, full height, and the only vertical line on the
       card, so nothing else can be mistaken for it. */
    ['.ck-cp-ref', 'stroke: var(--ink-dim); stroke-width: 1; fill: none;'],
    ['.ck-cp-tick', 'stroke: var(--ck-grid); stroke-width: 1; fill: none;'],
    ['.ck-cp-void', 'fill: none; stroke: var(--rule); stroke-width: 1; stroke-dasharray: 3 3;'],

    ['.ck-cp-read',
     'font-family: var(--mono); font-size: 10.5px; color: var(--ink-dim); ' +
     'text-align: right; font-variant-numeric: tabular-nums;'],
    ['.ck-cp-pct', 'color: var(--ink); font-size: 11.5px;'],
    ['.ck-cp-over-say', 'color: var(--ck-s1);'],
    ['.ck-cp-say', 'display: block; color: var(--ink-faint); font-size: 10px;'],
    ['.ck-capacity.ck-cp-noabs .ck-cp-abs', 'display: none;'],
    ['.ck-capacity.ck-cp-dense .ck-cp-say', 'display: none;'],
    ['.ck-cp-note', 'grid-column: 2 / -1; font-size: 10.5px; color: var(--ink-faint);'],
    ['.ck-capacity.ck-cp-dense .ck-cp-note', 'display: none;'],

    /* The team row is the same drawing on the same scale, so the two answers can be compared by
       eye. It is separated by a rule rather than by a colour, because it is not a person and
       should not read as the loudest one. */
    ['.ck-cp-team', 'border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-top: 4px;'],
    ['.ck-cp-team .ck-cp-lab', 'color: var(--ink-dim); font-family: var(--mono); font-size: 11px;'],

    /* The ruler borrows the row's grid so its ticks land above the positions they name. It is not
       a row, so it gives back the row's rule and its hover. */
    ['.ck-cp-rulerrow', 'border-bottom: none; padding-bottom: 0; align-items: end;'],
    ['.ck-cp-rulerrow:hover', 'background: transparent;'],
    ['.ck-cp-rulerrow .ck-cp-lab', 'font-family: var(--mono); font-size: 10px; color: var(--ink-faint);'],
    ['.ck-cp-rulerrow .ck-cp-read', 'color: var(--ink-faint); font-size: 10px;'],

    ['.ck-cp-list', 'margin-top: 4px;'],
    ['.ck-cp-void-msg', 'font-family: var(--mono); font-size: 11px; color: var(--ink-faint); padding: 12px 0 4px;'],
    ['.ck-cp-find', 'display: block; margin: 0 0 4px;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n';
}

/**
 * One row's track, as SVG markup.
 *
 * The x axis is the RATIO axis: `x(1)` is that person's own availability and it is the same
 * position on every row, which is the entire reason this card exists rather than a second bullet
 * chart. `preserveAspectRatio="none"` stretches x only, and every stroke carries
 * `vector-effect="non-scaling-stroke"` so the rule and the hatch stay one pixel however wide the
 * desk column is.
 *
 * @param p  a person from {@link readData}, or the synthetic team row
 * @param hi the top of the shared ratio scale
 *
 * @example trackSvg({ state: 'ok', ratio: 0.5 }, 1.25).indexOf('ck-cp-under') > 0;   // true
 */
function trackSvg(p, hi) {
  const x = CK.scale([0, hi], [0, VB]);
  const marks = ['<rect class="ck-cp-base" x="0" y="1" width="' + VB + '" height="10"/>'];

  if (p.state === 'unstated' || p.state === 'refused') {
    marks.push('<rect class="ck-cp-void" x="0.5" y="1.5" width="' + (VB - 1) +
               '" height="9" vector-effect="non-scaling-stroke"/>');
  } else {
    /* A person with zero availability has no ratio and never will. The bar is drawn full, which is
       the truthful picture of "everything you have is nothing", and the readout says so in words
       rather than printing a percentage that would have to be a division by zero. */
    const r = p.state === 'zero' ? (p.committed > 0 ? hi : 0) : p.ratio;
    const shown = Math.min(r, hi);

    if (shown <= 0) {
      /* Zero committed is a measurement and is drawn as one. A card that draws nothing for zero
         looks identical to a card whose number never arrived, and those are different facts. */
      marks.push('<rect class="ck-cp-stub" x="0" y="2" width="2" height="8"/>');
    } else {
      const under = Math.min(shown, 1);
      marks.push('<rect class="ck-cp-under" x="0" y="2" width="' + n2(x(under), 'under') +
                 '" height="8"/>');
      if (shown > 1) {
        const x1 = x(1);
        const x2 = x(shown);
        marks.push('<rect class="ck-cp-over" x="' + n2(x1, 'over x') + '" y="2" width="' +
                   n2(x2 - x1, 'over w') + '" height="8"/>');
        const span = x2 - x1;
        const step = Math.max(span / HATCH_MAX, 7);
        for (let t = x1 + step; t < x2 - 0.5; t += step) {
          marks.push('<line class="ck-cp-hatch" x1="' + n2(t, 'hatch') + '" y1="2" x2="' +
                     n2(t, 'hatch') + '" y2="10" vector-effect="non-scaling-stroke"/>');
        }
      }
    }

    /* The bar ran past the end of the drawing. Cut it with a chevron rather than letting the scale
       grow: the readout still carries the true number, and every other row stays legible. */
    if (r > hi + 1e-9) {
      marks.push('<path class="ck-cp-clipmark" d="M' + (VB - 9) + ' 2.5 L' + (VB - 3) +
                 ' 6 L' + (VB - 9) + ' 9.5" vector-effect="non-scaling-stroke"/>');
    }
  }

  marks.push('<line class="ck-cp-ref" x1="' + n2(x(1), 'ref') + '" y1="0" x2="' +
             n2(x(1), 'ref') + '" y2="12" vector-effect="non-scaling-stroke"/>');

  return '<svg class="ck-cp-track" viewBox="0 0 ' + VB + ' 12" preserveAspectRatio="none" ' +
         'aria-hidden="true">' + marks.join('') + '</svg>';
}

/**
 * The ruler above the rows: the same x mapping, with the ticks labelled in per cent.
 *
 * It shares the row tracks' viewBox width and is laid out in the same grid column, so a tick label
 * sits above the position it names. Ticks come from `CK.ticks`, the desk's own nice-step routine,
 * so the numbers are the ones a chart on the same desk would have chosen.
 */
function rulerSvg(hi) {
  const x = CK.scale([0, hi], [0, VB]);
  const marks = [];
  const stops = CK.ticks(0, hi, 4);
  if (stops.indexOf(1) < 0) stops.push(1);

  for (const t of stops) {
    if (t < 0 || t > hi + 1e-9) continue;
    const px = n2(x(t), 'ruler');
    const anchor = t <= 0 ? 'start' : (t >= hi - 1e-9 ? 'end' : 'middle');
    marks.push('<line class="' + (t === 1 ? 'ck-cp-ref' : 'ck-cp-tick') + '" x1="' + px +
               '" y1="10" x2="' + px + '" y2="16" vector-effect="non-scaling-stroke"/>');
    marks.push('<text x="' + px + '" y="9" text-anchor="' + anchor + '">' +
               pctOf(t) + '%</text>');
  }

  return '<svg class="ck-cp-ruler" viewBox="0 0 ' + VB + ' 18" aria-hidden="true">' +
         marks.join('') + '</svg>';
}

/**
 * The readout column: the percentage, the two absolute amounts, and the finding in words.
 *
 * Every span ends with a full stop and a space inside itself, so the flattened form a screen
 * reader or a clipboard receives reads as sentences rather than as a run of fused numbers. The
 * grid container this sits in drops whitespace-only text nodes, so a separator written between two
 * spans would simply not exist.
 */
function readoutHtml(p, unit) {
  const e = CK.esc;
  const bits = [];

  if (p.state === 'ok') {
    const pc = pctOf(p.ratio);
    bits.push('<span class="ck-cp-pct' + (p.ratio > 1 ? ' ck-cp-over-say' : '') + '">' +
              pc + '%. </span>');
    bits.push('<span class="ck-cp-abs">' + e(fmtAmount(p.committed, unit)) + ' of ' +
              e(fmtAmount(p.available, unit)) + '. </span>');
    bits.push('<span class="ck-cp-say">' +
              (p.ratio > 1 ? 'over by ' + (pc - 100) + '%. '
               : p.ratio === 1 ? 'exactly at capacity. '
               : p.committed === 0 ? 'nothing committed. '
               : 'under by ' + (100 - pc) + '%. ') +
              '</span>');
  } else if (p.state === 'zero') {
    bits.push('<span class="ck-cp-pct ck-cp-over-say">' +
              (p.committed > 0 ? 'no capacity. ' : 'none, none. ') + '</span>');
    bits.push('<span class="ck-cp-abs">' + e(fmtAmount(p.committed, unit)) + ' of ' +
              e(fmtAmount(0, unit)) + '. </span>');
    bits.push('<span class="ck-cp-say">' +
              (p.committed > 0
                ? 'availability is zero, so any commitment at all is over-commitment. '
                : 'nothing committed against nothing available. ') +
              '</span>');
  } else if (p.state === 'unstated') {
    bits.push('<span class="ck-cp-pct">not stated. </span>');
    bits.push('<span class="ck-cp-abs">' + e(fmtAmount(p.committed, unit)) + ' committed. </span>');
    bits.push('<span class="ck-cp-say">no availability was recorded, so there is no ratio to draw. </span>');
  } else {
    bits.push('<span class="ck-cp-pct">refused. </span>');
    bits.push('<span class="ck-cp-say">' + e(p.bad.join('; ') + '. ') + '</span>');
  }

  return '<span class="ck-cp-read">' + bits.join('') + '</span>';
}

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * A comma-joined list of at most {@link NAME_CAP} names, with the remainder counted.
 *
 * @example names([{ label: 'a' }, { label: 'b' }]);   // 'a, b'
 */
function names(items) {
  const shown = items.slice(0, NAME_CAP).map((x) => clip(x.label, 28));
  const rest = items.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : '');
}

/**
 * The sentences the caption prints, in the order a reader wants them.
 *
 * The team paragraph is the reason this card is not a bullet multiple, so it is stated first and
 * it always says whether the team answer and the individual answers agree. Those are two different
 * questions and the case where they disagree -- a team over its hours while nobody personally is,
 * or the reverse -- is the case a reader most needs told, because neither row nor total shows it
 * on its own.
 *
 * @param R the output of {@link readData}
 * @returns `{ head, findings }` -- all plain text, escaped by the caller
 *
 * @example verdict(readData({})).head;   // 'Nobody is on this roster.'
 */
function verdict(R) {
  const findings = [];
  const unit = R.unit;
  const ok = R.people.filter((p) => p.state === 'ok');
  const over = ok.filter((p) => p.ratio > 1);
  const unstated = R.people.filter((p) => p.state === 'unstated');
  const zero = R.people.filter((p) => p.state === 'zero');
  const refused = R.people.filter((p) => p.state === 'refused');
  const clipped = ok.filter((p) => p.ratio > R.hi + 1e-9);

  if (!R.people.length) return { head: 'Nobody is on this roster.', findings };

  const head =
    plural(R.people.length, 'person', 'people') +
    (R.period ? ' for ' + R.period : '') + ', ' + ok.length +
    ' with an availability this card can divide by.';

  if (R.team.ratio === null) {
    findings.push(
      'No team figure can be given, because nobody on this roster has an availability above zero ' +
      'to divide by.');
  } else {
    const teamPct = pctOf(R.team.ratio);
    findings.push(
      'Across the ' + R.team.counted + ' countable ' + (R.team.counted === 1 ? 'person' : 'people') +
      ', ' + fmtAmount(R.team.committed, unit) + ' are committed against ' +
      fmtAmount(R.team.available, unit) + ' available: ' + teamPct + '%.');

    /* The dissociation. This is the sentence bullet.mjs has nowhere to put, and it is the whole
       argument for the type: a total and a row answer different questions and can disagree. */
    if (teamPct > 100 && !over.length) {
      findings.push(
        'The team is over-committed while not one individual is over their own availability. ' +
        'Those are different questions, and this is the case where they disagree: the work fits ' +
        'nobody in particular and still does not fit the team.');
    } else if (teamPct <= 100 && over.length) {
      findings.push(
        'The team as a whole is within its hours, and ' + plural(over.length, 'person is', 'people are') +
        ' not. A total cannot absolve a row: the spare capacity is on somebody else.');
    } else if (teamPct > 100 && over.length) {
      findings.push(
        'The team is over-committed and so ' + (over.length === 1 ? 'is ' : 'are ') +
        plural(over.length, 'person', 'people') + ' individually.');
    } else {
      findings.push('The team is within its hours and so is every individual on it.');
    }
  }

  if (over.length) {
    findings.push(
      plural(over.length, 'person is', 'people are') + ' over their own availability: ' +
      over.slice(0, NAME_CAP).map((p) => clip(p.label, 28) + ' at ' + pctOf(p.ratio) + '%').join(', ') +
      (over.length > NAME_CAP ? ', and ' + (over.length - NAME_CAP) + ' more' : '') + '.');
  }

  if (clipped.length) {
    findings.push(
      plural(clipped.length, 'bar runs', 'bars run') + ' past the end of the track, which stops at ' +
      pctOf(R.hi) + '%. The percentage in the readout is the true figure; the drawing is not.');
  }

  if (unstated.length) {
    findings.push(
      plural(unstated.length, 'person has', 'people have') + ' no stated availability: ' +
      names(unstated) + '. Their ' + fmtAmount(R.team.outsideUnstated, unit) +
      ' of commitment sits outside the team figure, because a ratio needs a denominator and ' +
      'inventing one would be making the total up.');
  }

  if (zero.length) {
    findings.push(
      plural(zero.length, 'person has', 'people have') + ' an availability of exactly zero, which ' +
      'is not the same as unstated: ' + names(zero) + '. Any commitment at all against zero is ' +
      'over-commitment, and the card says that rather than dividing by it; the ' +
      fmtAmount(R.team.outsideZero, unit) + ' committed there is outside the team figure too.');
  }

  if (refused.length) {
    findings.push(
      plural(refused.length, 'row was', 'rows were') + ' refused for an unusable amount: ' +
      names(refused) + '. Nothing was coerced to zero, because a zero somebody did not write is a ' +
      'number this card would have invented.');
  }

  return { head, findings };
}

/**
 * The card's markup: one section, a gear, a settings panel, the ruler, the rows and the caption.
 *
 * Every interpolated value goes through `CK.esc`, which drops control characters before escaping
 * the five HTML metacharacters -- so a person's name carrying a closing script tag, an `onerror`
 * attribute or a NUL comes out as text in all three cases.
 */
function cardHtml(id, title, R) {
  const e = CK.esc;
  const v = verdict(R);
  const unit = R.unit;

  const rowHtml = (p, extraClass) =>
    '<li class="ck-cp-row' + (extraClass ? ' ' + extraClass : '') + '" data-i="' + p.index +
    '" data-load="' + (p.sortLoad === null ? '' : p.sortLoad) + '"' +
    (p.sortInf ? ' data-inf="1"' : '') +
    ' data-name="' + e(p.label.toLowerCase()) + '">' +
    '<span class="ck-cp-lab" title="' + e(p.label) + '">' + e(clip(p.label, LABEL_CHARS)) + ' </span>' +
    trackSvg(p, R.hi) +
    readoutHtml(p, unit) +
    (p.note ? '<span class="ck-cp-note">' + e(clip(p.note, 160)) + ' </span>' : '') +
    '</li>';

  /* The sort keys are decided here rather than in the browser, so the browser never has to know
     what a state means. A person with no ratio has no load and sinks in both directions; a person
     with zero availability has an unbounded one and is flagged rather than given a fake number. */
  for (const p of R.people) {
    p.sortLoad = p.state === 'ok' ? Math.round(p.ratio * 1000) : null;
    p.sortInf = p.state === 'zero' && p.committed > 0;
  }

  const rows = R.people.length
    ? '  <ul class="ck-cp-list">\n    ' +
      R.people.map((p) => rowHtml(p)).join('\n    ') + '\n  </ul>\n'
    : '  <div class="ck-cp-void-msg">nothing to draw &mdash; this roster has no people</div>\n';

  const teamRow = R.team.ratio === null ? '' : rowHtml({
    index: -1,
    label: 'the team',
    note: '',
    state: 'ok',
    committed: R.team.committed,
    available: R.team.available,
    ratio: R.team.ratio,
    bad: [],
    sortLoad: null,
    sortInf: false,
  }, 'ck-cp-team');

  const ruler = R.people.length
    ? '  <div class="ck-cp-row ck-cp-rulerrow"><span class="ck-cp-lab">of availability </span>' +
      rulerSvg(R.hi) +
      '<span class="ck-cp-read">the rule is 100%. </span></div>\n'
    : '';

  const junk = [];
  if (R.dupes) junk.push(plural(R.dupes, 'duplicate id was', 'duplicate ids were') + ' dropped, first one kept');

  /* Each sentence is its own block and carries its own trailing space INSIDE the element.
     `textContent` concatenates block children with nothing between them, so a sentence ending in a
     full stop would otherwise run straight into the next one's first word. */
  const findings = v.findings.map((s) => '<i class="ck-cp-find">' + e(s) + ' </i>').join('');

  return '<section data-card="' + e(id) + '" class="ck-capacity">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-sort">order</label>\n' +
    '    <select id="' + e(id) + '-sort" name="sort">\n' +
    '      <option value="given">as given</option>\n' +
    '      <option value="load">most committed first</option>\n' +
    '      <option value="name">by name</option>\n' +
    '    </select>\n' +
    '    <label for="' + e(id) + '-absolute">show amounts</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-absolute" name="absolute">\n' +
    '    <label for="' + e(id) + '-dense">dense rows</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-dense" name="dense">\n' +
    '    <div class="ck-set-foot">every bar is drawn against that person&#39;s own availability, ' +
    'so the vertical rule is one hundred per cent for everybody and a bar past it is ' +
    'over-allocation. the team row is on the same scale and answers a different question.</div>\n' +
    '  </div>\n' +
    ruler + teamRow + rows +
    '  <div class="ck-cap">' + e(v.head) + ' ' + findings +
    '<i class="ck-cp-shown"></i>' +
    (junk.length ? '<span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '') +
    '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: reordering rows and toggling two classes, never drawing a track.
 *
 * Classic script, ES5 vocabulary, built by concatenation and passed through {@link guardEmitted}.
 *
 * The reorder MOVES existing elements into a fragment and puts the fragment back. Moving cannot
 * duplicate, so a `<main>` swap that replays this builder reorders the same nodes rather than
 * appending a second roster underneath the first.
 */
function cardJs(id) {
  const src =
    '/* capacity card: every track was drawn in Node. This reorders rows and toggles classes. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var list = sec.querySelector("ul.ck-cp-list");\n' +
    '  var shownEl = sec.querySelector(".ck-cp-shown");\n' +
    '  if (!list) { return; }\n' +
    '\n' +
    '  var items = [], i;\n' +
    '  for (i = 0; i < list.children.length; i++) {\n' +
    '    items.push({ el: list.children[i] });\n' +
    '  }\n' +
    '\n' +
    '  /* The roster position comes out of the MARKUP, not out of the order the elements were\n' +
    '     captured in. The builder is replayed on every desk swap, and by then a previous sort\n' +
    '     has already permuted the list -- so a capture-order index would make "as given" mean\n' +
    '     "as it was left", and the order the author wrote could never be recovered. */\n' +
    '  function src(el) {\n' +
    '    var v = Number(el.getAttribute("data-i"));\n' +
    '    return isFinite(v) ? v : 0;\n' +
    '  }\n' +
    '\n' +
    '  function loadOf(el) {\n' +
    '    var raw = el.getAttribute("data-load");\n' +
    '    if (raw === null || raw === "") { return null; }\n' +
    '    var v = Number(raw);\n' +
    '    return isFinite(v) ? v : null;\n' +
    '  }\n' +
    '\n' +
    '  /* Three classes of row and they do not compare: a person with zero availability is over\n' +
    '     every finite load and sorts first, a person with no stated availability has no load at\n' +
    '     all and sinks to the bottom in BOTH directions, because absent is not small. */\n' +
    '  function byLoad(a, b) {\n' +
    '    var ai = a.el.getAttribute("data-inf") === "1";\n' +
    '    var bi = b.el.getAttribute("data-inf") === "1";\n' +
    '    if (ai !== bi) { return ai ? -1 : 1; }\n' +
    '    var av = loadOf(a.el), bv = loadOf(b.el);\n' +
    '    if (av === null || bv === null) {\n' +
    '      if (av === null && bv === null) { return 0; }\n' +
    '      return av === null ? 1 : -1;\n' +
    '    }\n' +
    '    return bv - av;\n' +
    '  }\n' +
    '\n' +
    '  function byName(a, b) {\n' +
    '    var an = a.el.getAttribute("data-name") || "";\n' +
    '    var bn = b.el.getAttribute("data-name") || "";\n' +
    '    return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });\n' +
    '  }\n' +
    '\n' +
    '  function cmp(mode) {\n' +
    '    return function (a, b) {\n' +
    '      var r = 0;\n' +
    '      if (mode === "load") { r = byLoad(a, b); }\n' +
    '      else if (mode === "name") { r = byName(a, b); }\n' +
    '      /* Stability made explicit rather than borrowed from the engine. */\n' +
    '      return r !== 0 ? r : src(a.el) - src(b.el);\n' +
    '    };\n' +
    '  }\n' +
    '\n' +
    '  function apply(cfg) {\n' +
    '    var mode = cfg.sort === "load" || cfg.sort === "name" ? cfg.sort : "given";\n' +
    '    var k, frag, order;\n' +
    '\n' +
    '    sec.classList.toggle("ck-cp-dense", !!cfg.dense);\n' +
    '    sec.classList.toggle("ck-cp-noabs", !cfg.absolute);\n' +
    '\n' +
    '    order = items.slice(0);\n' +
    '    order.sort(cmp(mode));\n' +
    '    frag = document.createDocumentFragment();\n' +
    '    for (k = 0; k < order.length; k++) { frag.appendChild(order[k].el); }\n' +
    '    list.appendChild(frag);\n' +
    '\n' +
    '    /* Set, never appended: the desk replays every builder after a swap, and a line that grew\n' +
    '       by one sentence per swap is the failure this comment guards against. */\n' +
    '    if (shownEl) {\n' +
    '      shownEl.textContent = mode === "given" ? "" : "Rows are ordered by " + mode + ". ";\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, ' + jsLit(defaults) + ', apply);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/capacity');
}

/**
 * Build one capacity card.
 *
 * Every degenerate case has a decided answer rather than a crash, and every one is said out loud:
 *
 * - **no data at all** draws no rows and says the roster has no people
 * - **one person** draws one row and a team row identical to it, which is the honest picture
 * - **a person with no availability** draws a dashed empty track, says "no availability was
 *   recorded", and is held out of the team figure with their committed hours counted separately
 * - **an availability of zero** is kept apart from that: the bar runs the full track and the
 *   readout says any commitment at all is over-commitment, rather than printing a division by zero
 * - **committed exceeding available by three times** draws a bar three times past the rule, inside
 *   the scale, hatched, with "over by 200%" in the readout
 * - **beyond four times** cuts the bar with a chevron and says the readout carries the true figure
 * - **a negative commitment** is refused, counted and named; nothing is coerced to zero
 * - **an unparseable amount** is refused the same way, with the offending text quoted back
 * - **a team over-committed while every individual is under** is stated explicitly, because that is
 *   the one fact neither a row nor a total shows on its own
 * - **duplicate ids** keep the first and count the rest
 * - **300 rows** and **a 300-character name** are handled by clipping the name with the cut marked
 *   and keeping the whole of it in `title`
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  see {@link meta} for the shape; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the team figure and every count, so a test
 *          can check what the caption claims without re-deriving it
 * @throws {Error} when a coordinate comes out non-finite, which means a bug here rather than bad
 *                 input, and from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * build({ id: 'sprint', title: 'sprint 12 capacity', ord: 35, data: { unit: 'h', people: [
 *   { label: 'Ana', committed: 36, available: 40 },
 *   { label: 'Ben', committed: 22, available: 12 },
 * ] } }).json.team.percent;   // 112
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'capacity' : id);
  const heading = String(title == null ? cardId : title);

  const R = readData(data);
  const ok = R.people.filter((p) => p.state === 'ok');

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      category: meta.category,
      people: R.people.length,
      counted: R.team.counted,
      team: {
        committed: R.team.committed,
        available: R.team.available,
        percent: R.team.ratio === null ? null : pctOf(R.team.ratio),
        outsideCommitted: R.team.outsideCommitted,
      },
      over: ok.filter((p) => p.ratio > 1).length,
      clipped: ok.filter((p) => p.ratio > R.hi + 1e-9).length,
      unstated: R.people.filter((p) => p.state === 'unstated').length,
      zeroAvailable: R.people.filter((p) => p.state === 'zero').length,
      refused: R.people.filter((p) => p.state === 'refused').length,
      scaleTop: pctOf(R.hi),
      dupes: R.dupes,
    },
    html: cardHtml(cardId, heading, R),
    css: cardCss(cardId),
    js: cardJs(cardId),
  };
}

export default { meta, defaults, build };
