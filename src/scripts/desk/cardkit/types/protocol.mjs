/**
 * `protocol` — a sequence diagram: actors across the top, lifelines descending, messages as
 * arrows between them in the order they happen.
 *
 * The kinds are told apart by LINE STYLE and ARROWHEAD, never by colour alone. A call is a solid
 * line with a filled head; a return is dashed with an open head; an async message is solid with
 * an open head; a self message is a loop; a lost message is a half-arrow ending in a filled dot,
 * and a found message is the same shape run backwards. Colour reinforces the distinction and
 * carries none of it, so the diagram survives a monochrome print, a colour-blind reader and a
 * theme switch — three failure modes that a legend keyed on hue does not.
 *
 * Activation bars are DERIVED, not declared: a `call` opens one on its target and a `return`
 * closes the target's most recent open one. That means the data can be unbalanced, and this card
 * refuses to hide it. A call that never returns leaves its bar running to the bottom of the
 * diagram with a torn edge; a return that closes nothing gets a hollow ring at its tail. Both are
 * counted and named in the caption. Silently balancing them would turn a bug in the protocol
 * being documented into a tidy picture, which is the opposite of the job.
 *
 * Everything geometric is computed by {@link pxRender}, the same function in Node and in the
 * browser: Node runs it once for the picture inside `card.html`, and the browser re-runs it when
 * the reader changes a setting. `CK` comes out of `kit.js` in a `node:vm` context, so the helpers
 * here are the ones the page has.
 *
 * WHAT THIS TOOK FROM THE REPOSITORY'S OWN SEQUENCE RENDERER, and what it left, is recorded under
 * {@link build}.
 *
 * @see ./flow.mjs  — the same actors without the time axis
 * @see ./graph.mjs — the node-link sibling, where order does not exist
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level only defines functions and one array, so a bare context carrying a
 * `window` object is enough to run it.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().esc('a<b');   // 'a&lt;b'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/protocol: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/protocol: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── budgets ─────────────────────────────────────────────────────────────────────────── */

const W0   = 640;
const WMAX = 2200;

/* Caps on the PAYLOAD, not on the arithmetic: the caption's counts come from the complete input
   before anything is dropped, and every drop is itself reported. */
const ACTCAP = 16;
const MSGCAP = 300;

/** The message kinds this card draws. Anything else is read as a call. */
const KINDS = ['call', 'return', 'async', 'self', 'lost', 'found'];

/**
 * Every setting this card understands, with its fallback.
 *
 * Declared before `meta` and spread into it, so there is one written source and two places to
 * read it; a binding declared after `meta` could not be referenced by it at all.
 *
 * Numbering and activations are both on by default because both answer questions the drawing
 * alone cannot: which message came first when two arrows nearly touch, and how long a participant
 * was busy. `compact` is off, because the first reading of a protocol wants air.
 */
export const defaults = {
  numbering:   true,
  activations: true,
  compact:     false,
};

/**
 * What this card type is and what it will accept, for a deck index or a picker.
 *
 * `flow-and-relationship` — "what connects to what?" — rather than `evolution`. A sequence
 * diagram does run down a time axis, but nobody reaches for one to ask what changed over time;
 * they reach for it to ask who talks to whom, and in what order.
 */
export const meta = {
  name: 'protocol',
  summary:
    'A sequence diagram: lifelines, messages told apart by line style and arrowhead rather than ' +
    'colour, and activation bars derived from the call and return pairing.',
  shape:
    "{ actors: [{ id, label }], messages: [{ from, to, label, kind, note }], title } — " +
    "kind is 'call' | 'return' | 'async' | 'self' | 'lost' | 'found'",
  category: 'flow-and-relationship',
  defaults: { ...defaults },
};

/* ── the build-time guard ────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" — and a
 * guard that cries wolf is a guard somebody switches off. Offsets are preserved so a reported
 * position still points at the right place. Regex literals are recognised, because otherwise the
 * scanner desynchronises on the quote inside a `replace` call and starts blanking real code,
 * which turns a false positive into a far worse false negative.
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
    /* A slash is a regex only where a value cannot precede it. Tracking the previous significant
       character is the cheap approximation that gets this right for real code. */
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
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in
 * a comment as readily as in code, because `Function.prototype.toString()` ships comments
 * verbatim — closes the surrounding template literal early and blanks every card on the desk.
 * The backtick is never written in this file; it is reached for as `String.fromCharCode(96)`,
 * which cannot be mistyped and cannot be mis-decoded during emission.
 *
 * Backtick, arrow and optional chaining are scanned raw, because none of them can appear
 * innocently. The declaration keywords are scanned only after {@link blankNonCode}, because they
 * can and do appear innocently in English.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/protocol';
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

/* ── reading the data ────────────────────────────────────────────────────────────────── */

/** An endpoint as a plain id, or '' when it was never given. */
function endpoint(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/**
 * Normalise whatever arrived into the actor list and the message list the renderer may assume.
 *
 * The actor set follows the repository's own `normalizeGraph`: an explicit `actors` list fixes
 * both the columns and their left-to-right order, and a message naming an id that is not in it is
 * refused rather than inventing a column. When `actors` is absent or empty the columns are
 * INFERRED from the message endpoints in first-appearance order, which is the same rule and the
 * same reason — a diagram of nothing is not renderable, but a diagram whose participants are
 * implied by its traffic is.
 *
 * Where this deliberately parts company with `normalizeGraph` is that nothing throws. That
 * function is called by an author who can fix the input; a card is handed data by a desk and must
 * still draw. So a duplicate actor id keeps its first occurrence and counts the rest, an unknown
 * endpoint refuses that one message and counts it, and every refusal is named in the caption
 * instead of being raised.
 *
 * `lost` and `found` are the one asymmetry: a lost message by definition never arrives, so its
 * `to` may be absent, and a found message's `from` may be absent for the mirror reason. An
 * endpoint that is PRESENT but unknown is still refused, because that is a typo rather than a
 * statement about the protocol.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns the payload {@link pxRender} takes, plus the counts the caption reports
 *
 * @example
 * readData({ messages: [{ from: 'a', to: 'b', label: 'get' }] }).actors.length;   // 2
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const rawActors = Array.isArray(d.actors) ? d.actors : [];
  const rawMsgs = Array.isArray(d.messages) ? d.messages : [];

  const refused = [];
  const dupActors = [];
  let droppedMsgs = 0;

  /* ── the columns ── */
  const index = new Map();
  const actors = [];
  let droppedActors = 0;

  const add = (id, label) => {
    if (!id) return;
    if (index.has(id)) return;
    if (actors.length >= ACTCAP) { droppedActors++; return; }
    index.set(id, actors.length);
    actors.push({ id, label: label == null || label === '' ? id : String(label) });
  };

  const declared = rawActors.length > 0;
  if (declared) {
    for (const a of rawActors) {
      const id = a && typeof a === 'object' ? endpoint(a.id) : endpoint(a);
      if (!id) { refused.push('an actor was declared with no id'); continue; }
      if (index.has(id)) { dupActors.push(id); continue; }
      add(id, a && typeof a === 'object' ? a.label : null);
    }
  } else {
    for (const m of rawMsgs) {
      if (!m || typeof m !== 'object') continue;
      add(endpoint(m.from), null);
      add(endpoint(m.to), null);
    }
  }

  /* ── the traffic ── */
  const msgs = [];
  for (let i = 0; i < rawMsgs.length; i++) {
    const m = rawMsgs[i];
    if (!m || typeof m !== 'object') { refused.push('message ' + (i + 1) + ' is not an object'); continue; }
    if (msgs.length >= MSGCAP) { droppedMsgs++; continue; }

    const kind = KINDS.indexOf(m.kind) >= 0 ? m.kind : 'call';
    const from = endpoint(m.from);
    const to = endpoint(m.to);

    /* Which end MUST exist. A lost message never arrives and a found one has no recorded sender,
       so each has one end it is allowed to leave open — and only one. */
    const fromOptional = kind === 'found';
    const toOptional = kind === 'lost';

    let f = index.has(from) ? index.get(from) : -1;
    let t = index.has(to) ? index.get(to) : -1;

    if (f < 0 && !(fromOptional && from === '')) {
      refused.push('message ' + (i + 1) + ' (' + (m.label == null ? kind : String(m.label)) +
                   ') names an unknown sender ' + JSON.stringify(from));
      continue;
    }
    if (t < 0 && !(toOptional && to === '')) {
      refused.push('message ' + (i + 1) + ' (' + (m.label == null ? kind : String(m.label)) +
                   ') names an unknown recipient ' + JSON.stringify(to));
      continue;
    }
    if (f < 0 && t < 0) {
      refused.push('message ' + (i + 1) + ' names neither end');
      continue;
    }

    msgs.push({
      f, t, kind,
      label: m.label == null ? '' : String(m.label),
      note:  m.note == null ? '' : String(m.note),
    });
  }

  return {
    actors, msgs,
    title: d.title == null ? '' : String(d.title),
    refused, dupActors, droppedActors, droppedMsgs,
    declared,
    W0, WMAX,
  };
}

/* ── the shipped half ────────────────────────────────────────────────────────────────── */
/* Written in the browser's vocabulary from here down to the SHIPPED list — var and function, no
   arrows, no template literals, no backtick in any comment — because every one of these is
   emitted verbatim through Function.prototype.toString() and is ALSO run here, in Node, to draw
   the copy that ships inside card.html. One source, two runtimes, nothing to drift. */

/**
 * Round a coordinate to two decimals, refusing to emit one that is not a number.
 *
 * A non-finite number in a path is silent: the browser drops the whole `d` and the drawing simply
 * is not there, with nothing in the console.
 *
 * @throws {Error} when v is not finite, which means a bug in the geometry rather than bad input
 * @example fin(12.3456);   // 12.35
 */
function fin(v) {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('cardkit/protocol: non-finite coordinate (' + v + ')');
  }
  return Math.round(v * 100) / 100;
}

/** Width in px of a string set in the diagram's mono face at `size`, defaulting to 9px. */
function tw(s, size) { return String(s).length * 5.42 * ((size || 9) / 9); }

/** Shorten a label to `max` px, keeping the head and marking the cut with an ellipsis. */
function clipTo(s, max, size) {
  var str = String(s);
  var per = 5.42 * ((size || 9) / 9);
  var room = Math.floor(max / per);
  if (room < 1) { return ''; }
  if (str.length <= room) { return str; }
  return str.slice(0, Math.max(1, room - 1)) + '\u2026';
}

/** Break text into lines of at most `cols` characters, splitting a word only when it must. */
function pxWrap(s, cols) {
  var words = String(s).split(' '), out = [], line = '', i, w;
  for (i = 0; i < words.length; i++) {
    w = words[i];
    while (w.length > cols) {
      if (line) { out.push(line); line = ''; }
      out.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!line) { line = w; }
    else if (line.length + 1 + w.length <= cols) { line = line + ' ' + w; }
    else { out.push(line); line = w; }
  }
  if (line) { out.push(line); }
  return out.length ? out : [''];
}

/* Display-list primitives. Every mark is { t: tagName, a: attributes, s: text, ti: tooltip,
   kids: [] }, with real SVG attribute names, so the browser-side translator knows nothing about
   sequence diagrams and a mark in a debugger reads as the element it becomes. */

function mLine(x1, y1, x2, y2, cls) {
  return { t: 'line', a: { x1: fin(x1), y1: fin(y1), x2: fin(x2), y2: fin(y2), 'class': cls || '' } };
}

function mText(x, y, s, cls, anchor) {
  return { t: 'text', a: { x: fin(x), y: fin(y), 'class': cls || '', 'text-anchor': anchor || 'start' },
           s: String(s) };
}

function mRect(x, y, w, h, cls, rx) {
  var a = { x: fin(x), y: fin(y), width: fin(Math.max(0, w)), height: fin(Math.max(0, h)),
            'class': cls || '' };
  if (rx) { a.rx = fin(rx); }
  return { t: 'rect', a: a };
}

function mPath(d, cls) { return { t: 'path', a: { d: d, 'class': cls || '' } }; }

function mDot(cx, cy, r, cls) {
  return { t: 'circle', a: { cx: fin(cx), cy: fin(cy), r: fin(r), 'class': cls || '' } };
}

/**
 * Settle a settings object into the three values the renderer may assume.
 *
 * Called with nothing it must return exactly {@link defaults}; the test suite asserts that, so
 * the shipped copy and the declared metadata cannot drift apart without something failing.
 *
 * @example pxConfig({ compact: true }).numbering;   // true
 */
function pxConfig(conf) {
  var c = conf && typeof conf === 'object' ? conf : {};
  return {
    numbering:   c.numbering === undefined || c.numbering === null ? true : !!c.numbering,
    activations: c.activations === undefined || c.activations === null ? true : !!c.activations,
    compact:     c.compact === undefined || c.compact === null ? false : !!c.compact
  };
}

/**
 * Pair calls with returns and turn the result into activation spans.
 *
 * A `call` pushes an activation onto its TARGET; a `return` pops the topmost open activation of
 * its SENDER. Pairing is by kind and by lifeline, not by caller identity: a nested helper that
 * returns to somebody other than the caller is a real pattern, and refusing it would be a rule
 * about diagrams rather than about protocols. Every other kind is pairing-neutral — an async
 * message is by definition not waited on, a self message returns immediately by construction, and
 * a lost or found message has no partner to pair with.
 *
 * Nothing here is balanced silently. A return with no outstanding call is recorded on the message
 * as `orphan` and counted; an activation still open at the end is marked `open`, runs to the foot
 * of the diagram, and is counted. Both are named in the caption.
 *
 * @param msgs    the accepted messages, in order
 * @param nActors how many lifelines there are
 * @returns `{ spans, orphans, unclosed }` — spans carry `{ actor, from, to, depth, open }` as
 *          message INDICES, which the layout later turns into pixels
 *
 * @example
 * pair([{ f: 0, t: 1, kind: 'call' }, { f: 1, t: 0, kind: 'return' }], 2).spans[0].to;   // 1
 */
function pxPair(msgs, nActors) {
  var stacks = [], spans = [], orphans = 0, i, k, open, top;
  for (i = 0; i < nActors; i++) { stacks.push([]); }

  for (i = 0; i < msgs.length; i++) {
    if (msgs[i].kind === 'call' && msgs[i].t >= 0) {
      stacks[msgs[i].t].push({ actor: msgs[i].t, from: i, to: -1,
                               depth: stacks[msgs[i].t].length, open: true });
    } else if (msgs[i].kind === 'return' && msgs[i].f >= 0) {
      if (stacks[msgs[i].f].length) {
        top = stacks[msgs[i].f].pop();
        top.to = i;
        top.open = false;
        spans.push(top);
      } else {
        /* A return that closes nothing. It is drawn, because it happened; it is marked, because
           the diagram would otherwise imply an activation that was never opened. */
        msgs[i].orphan = true;
        orphans++;
      }
    }
  }

  var unclosed = 0;
  for (i = 0; i < stacks.length; i++) {
    for (k = 0; k < stacks[i].length; k++) {
      open = stacks[i][k];
      open.to = msgs.length - 1;
      unclosed++;
      spans.push(open);
    }
  }

  return { spans: spans, orphans: orphans, unclosed: unclosed };
}

/**
 * Column positions: one lifeline per actor, spaced so every label has somewhere to sit.
 *
 * The minimum gap comes from the two header boxes. It is then widened by any message that spans
 * it and needs more room than it has — the deficit is added to the LAST gap of the span, which is
 * enough because gaps only ever grow, so a constraint satisfied once stays satisfied however the
 * later ones move. That is the whole layout: no search, no iteration to a fixed point.
 *
 * A self loop and a lost or found message with an open end need room to one side rather than
 * between two lifelines, so they widen the neighbouring gap, or the outer margin when there is no
 * neighbour in that direction.
 *
 * @param P    the payload
 * @param M    metrics for the current density
 * @param cap  the widest a message label may claim, in px; the caller lowers it and re-runs when
 *             the first attempt overflows the width budget
 * @returns `{ lifeX, headW, W, right }`
 */
function pxColumns(P, M, cap) {
  var n = P.actors.length, i, j, a, b, need, have, gaps = [], headW = [], lifeX = [];

  for (i = 0; i < n; i++) {
    headW.push(Math.max(52, Math.min(180, tw(clipTo(P.actors[i].label, 168, 9.5), 9.5) + 18)));
  }
  for (i = 1; i < n; i++) {
    gaps.push((headW[i - 1] + headW[i]) / 2 + M.colGap);
  }

  var right = M.pad;
  for (i = 0; i < P.msgs.length; i++) {
    var m = P.msgs[i];
    var text = Math.min(cap, tw(m.label) + 18);
    var lone = m.f < 0 || m.t < 0 || m.f === m.t;

    if (!lone) {
      a = Math.min(m.f, m.t); b = Math.max(m.f, m.t);
      have = 0;
      for (j = a; j < b; j++) { have += gaps[j]; }
      need = text;
      if (need > have) { gaps[b - 1] += need - have; }
      continue;
    }

    /* One-sided: a self loop, or an arrow with one end in open space. It reaches to the right,
       unless it belongs to the rightmost actor, in which case it reaches left. */
    var at = m.f >= 0 ? m.f : m.t;
    need = M.loop + Math.min(cap, tw(m.label) + 10);
    if (at < n - 1) {
      if (gaps[at] < need + headW[at + 1] / 2) { gaps[at] = need + headW[at + 1] / 2; }
    } else if (need + M.pad > right) {
      right = need + M.pad;
    }
  }

  for (i = 0; i < n; i++) {
    if (i === 0) { lifeX.push(M.pad + headW[0] / 2); }
    else { lifeX.push(lifeX[i - 1] + gaps[i - 1]); }
  }

  var W = n ? lifeX[n - 1] + Math.max(headW[n - 1] / 2 + M.pad, right) : P.W0;
  return { lifeX: lifeX, headW: headW, W: W, right: right };
}

/**
 * Metrics for one density. Two numbers change the whole drawing's breathing room.
 *
 * @example pxMetrics(true).row;   // the compact row pitch
 */
function pxMetrics(compact) {
  return {
    pad:     compact ? 8 : 12,
    colGap:  compact ? 12 : 20,
    headH:   compact ? 22 : 28,
    titleH:  compact ? 14 : 18,
    row:     compact ? 15 : 20,
    labelH:  compact ? 11 : 13,
    loop:    compact ? 26 : 32,
    loopH:   compact ? 11 : 14,
    lost:    compact ? 38 : 48,
    act:     compact ? 6 : 8,
    noteW:   compact ? 120 : 150,
    noteCol: compact ? 19 : 24,
    foot:    compact ? 10 : 16
  };
}

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * `role="img"` hides the SVG's internals, so the label is the whole diagram to anyone using it.
 * A sequence diagram read aloud is a list of messages in order, so that is what the aria text is,
 * capped at a dozen before it says how many more there are — past that point a recitation stops
 * being navigation and becomes noise.
 *
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function pxNote(P, c, pairing, kindsSeen, shortened) {
  var n = P.actors.length, m = P.msgs.length, i, bits = [], said = [];

  if (!n) {
    return {
      aria: 'Sequence diagram with no actors: nothing is drawn.',
      caption: 'a sequence diagram with <b>no actors</b> &mdash; the card keeps its place, but ' +
               'there is nobody in it to send anything.'
    };
  }

  var names = [];
  for (i = 0; i < n; i++) { names.push(P.actors[i].label); }

  var verb = { call: 'calls', 'return': 'returns to', async: 'sends asynchronously to',
               self: 'calls itself in', lost: 'sends, lost, from', found: 'receives, found, at' };

  for (i = 0; i < m && i < 12; i++) {
    var mm = P.msgs[i];
    var who = mm.f >= 0 ? P.actors[mm.f].label : 'somewhere off the diagram';
    var whom = mm.t >= 0 ? P.actors[mm.t].label : 'somewhere off the diagram';
    said.push((i + 1) + ': ' + who + ' ' + (verb[mm.kind] || 'sends to') + ' ' + whom +
              (mm.label ? ', ' + mm.label : ''));
  }
  if (m > 12) { said.push('and ' + (m - 12) + ' more'); }

  var aria =
    'Sequence diagram, read top to bottom. ' + n + ' ' + (n === 1 ? 'actor' : 'actors') + ': ' +
    names.join(', ') + '. ' + (m ? m + ' ' + (m === 1 ? 'message' : 'messages') + '. ' + said.join('. ') + '.'
                                 : 'No messages: the lifelines are drawn and nothing travels along them.');

  /* Only the kinds actually present are explained. A legend for six kinds when the diagram uses
     two is furniture pretending to be information. */
  var enc = { call: 'a solid line with a filled head is a <i>call</i>',
              'return': 'a dashed line with an open head is a <i>return</i>',
              async: 'a solid line with an open head is <i>async</i>',
              self: 'a loop is a message to <i>self</i>',
              lost: 'a half-arrow ending in a dot is <i>lost</i>',
              found: 'a dot opening into a half-arrow is <i>found</i>' };
  var legend = [];
  for (i = 0; i < KINDS.length; i++) { if (kindsSeen[KINDS[i]]) { legend.push(enc[KINDS[i]]); } }

  if (P.refused.length) {
    bits.push('<i>' + P.refused.length + ' input' + (P.refused.length === 1 ? '' : 's') +
              ' refused</i>: ' + CK.esc(P.refused.slice(0, 4).join('; ')) +
              (P.refused.length > 4 ? ', and ' + (P.refused.length - 4) + ' more' : '') + '.');
  }
  if (P.dupActors.length) {
    bits.push('<i>' + P.dupActors.length + ' duplicate actor id' +
              (P.dupActors.length === 1 ? '' : 's') + '</i> (' + CK.esc(P.dupActors.join(', ')) +
              ') kept their first column and the repeats were dropped.');
  }
  if (P.droppedActors) bits.push('<i>' + P.droppedActors + ' actors past the drawing budget</i> were left out, along with anything addressed to them.');
  if (P.droppedMsgs)   bits.push('<i>' + P.droppedMsgs + ' messages past the drawing budget</i> were left out.');

  if (pairing.unclosed) {
    bits.push('<b>' + pairing.unclosed + ' call' + (pairing.unclosed === 1 ? '' : 's') +
              ' never returned</b> &mdash; ' + (pairing.unclosed === 1 ? 'its bar runs' : 'their bars run') +
              ' to the foot of the diagram with a torn edge rather than being closed for tidiness.');
  }
  if (pairing.orphans) {
    bits.push('<b>' + pairing.orphans + ' return' + (pairing.orphans === 1 ? '' : 's') +
              ' closed nothing</b> &mdash; ' + (pairing.orphans === 1 ? 'it is' : 'they are') +
              ' drawn with a hollow ring at the tail, because inventing a call to match would be ' +
              'the card editing the protocol.');
  }
  if (shortened) bits.push('<i>labels were shortened</i> to keep the drawing inside its width budget; every one is intact in its tooltip.');
  if (!c.activations && (pairing.unclosed || pairing.orphans)) {
    bits.push('<i>activation bars are switched off</i>, so those counts are stated here rather than shown.');
  }

  var caption =
    'sequence diagram &mdash; <b>' + CK.esc(String(n)) + '</b> ' + (n === 1 ? 'actor' : 'actors') +
    ', <b>' + CK.esc(String(m)) + '</b> ' + (m === 1 ? 'message' : 'messages') +
    ', read top to bottom. ' +
    (legend.length ? legend.join('; ') + '. ' : '') +
    (m ? '' : 'nothing travels along the lifelines yet. ') +
    bits.join(' ');

  return { aria: aria, caption: caption };
}

/**
 * Everything the card draws, from the payload and one settings object.
 *
 * The same function in Node and in the browser, so the caption can never describe a drawing that
 * is not the drawing on the screen. It grows DOWNWARD without limit, which is correct: a protocol
 * is read top to bottom and a long one is long. Only the width is budgeted, because sideways is
 * the direction a desk column cannot give.
 *
 * @param P    the payload from {@link readData}
 * @param conf a settings object, settled by {@link pxConfig}
 * @returns `{ W, H, marks, note, pairing }`
 *
 * @example pxRender(P, { compact: true }).H;
 */
function pxRender(P, conf) {
  var c = pxConfig(conf);
  var M = pxMetrics(c.compact);
  var n = P.actors.length;
  var msgs = P.msgs;
  var i, j, k;

  /* The pairing is computed whatever the settings say, because the counts it produces are facts
     about the data and belong in the caption even when the bars are switched off. */
  for (i = 0; i < msgs.length; i++) { msgs[i].orphan = false; }
  var pairing = pxPair(msgs, n);

  var kindsSeen = {};
  for (i = 0; i < msgs.length; i++) {
    kindsSeen[msgs[i].f >= 0 && msgs[i].f === msgs[i].t ? 'self' : msgs[i].kind] = true;
  }

  var anyNote = false;
  for (i = 0; i < msgs.length; i++) { if (msgs[i].note) { anyNote = true; } }

  if (!n) {
    var note0 = pxNote(P, c, pairing, kindsSeen, false);
    return {
      W: P.W0, H: 120, pairing: pairing, note: note0, rows: [], lifeX: [],
      marks: [mText(P.W0 / 2, 62, 'no actors', 'ck-empty', 'middle')]
    };
  }

  /* Columns, with one retry at a tighter label cap when the first attempt runs past the budget.
     Shortening the labels is the only lever that does not make the drawing wrong; every full
     label survives in its tooltip. */
  var cap = 220;
  var col = pxColumns(P, M, cap);
  var shortened = false;
  if (col.W > P.WMAX) { cap = 90; col = pxColumns(P, M, cap); shortened = true; }

  var noteW = anyNote ? M.noteW : 0;
  var W = Math.max(P.W0, col.W + noteW);
  var titleH = P.title ? M.titleH : 0;
  var headTop = titleH;
  var lifeTop = headTop + M.headH;

  /* ── rows ── */
  var rows = [], y = lifeTop + (c.compact ? 8 : 12);
  for (i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var isSelf = m.f >= 0 && m.f === m.t;
    /* The drawn text and the row height are decided together, so a row can never reserve space
       for a label the draw pass then declines to write, or the other way round. */
    var full = m.label ? (c.numbering ? (i + 1) + '. ' : '') + m.label
                       : (c.numbering ? (i + 1) + '.' : '');
    var labelH = full ? M.labelH : 0;
    var body = M.row + (isSelf ? M.loopH : 0);
    var lines = m.note ? pxWrap(m.note, M.noteCol) : [];
    var noteH = lines.length ? lines.length * 11 + 10 : 0;
    var h = Math.max(labelH + body, noteH + 6);
    rows.push({ top: y, arrowY: y + labelH + (c.compact ? 6 : 8), h: h, lines: lines,
                isSelf: isSelf, full: full });
    y += h;
  }
  var H = Math.max(lifeTop + 54, y + M.foot);

  var marks = [];

  if (P.title) { marks.push(mText(M.pad, titleH - 5, clipTo(P.title, W - M.pad * 2, 10), 'ck-dtitle', 'start')); }

  /* ── lifelines and heads ── */
  for (i = 0; i < n; i++) {
    marks.push(mLine(col.lifeX[i], lifeTop, col.lifeX[i], H - M.foot / 2, 'ck-life'));
  }
  for (i = 0; i < n; i++) {
    var hw = col.headW[i];
    var box = mRect(col.lifeX[i] - hw / 2, headTop, hw, M.headH, 'ck-actor', 3);
    box.ti = P.actors[i].id === P.actors[i].label ? P.actors[i].label
           : P.actors[i].label + ' (' + P.actors[i].id + ')';
    marks.push(box);
    marks.push(mText(col.lifeX[i], headTop + M.headH / 2 + 3.4,
                     clipTo(P.actors[i].label, hw - 10, 9.5), 'ck-aname', 'middle'));
  }

  /* ── activation bars ── */
  if (c.activations) {
    for (i = 0; i < pairing.spans.length; i++) {
      var sp = pairing.spans[i];
      if (!rows.length) { break; }
      var y0 = rows[sp.from].arrowY;
      var y1 = sp.open ? H - M.foot : rows[sp.to].arrowY;
      if (y1 < y0 + 6) { y1 = y0 + 6; }
      var bx = col.lifeX[sp.actor] - M.act / 2 + sp.depth * 3;
      var bar = mRect(bx, y0, M.act, y1 - y0, sp.open ? 'ck-act ck-act-open' : 'ck-act');
      bar.ti = P.actors[sp.actor].label + (sp.open ? ' \u00b7 active from message ' + (sp.from + 1) +
                 ' and never released' : ' \u00b7 active, messages ' + (sp.from + 1) + ' to ' + (sp.to + 1));
      marks.push(bar);
      if (sp.open) {
        /* A torn foot rather than a straight one: the bar did not end, it ran out of diagram. */
        var q = M.act / 4;
        marks.push(mPath('M' + fin(bx) + ' ' + fin(y1) + ' l' + fin(q) + ' 4 l' + fin(q) + ' -8 l' +
                         fin(q) + ' 8 l' + fin(q) + ' -4', 'ck-torn'));
      }
    }
  }

  /* ── the messages ── */
  for (i = 0; i < msgs.length; i++) {
    var mg = msgs[i];
    var row = rows[i];
    var ay = row.arrowY;
    var kids = [];
    var dashed = mg.kind === 'return';
    var lineCls = 'ck-msg' + (dashed ? ' ck-dash' : '');
    var tip = (mg.f >= 0 ? P.actors[mg.f].label : 'off-diagram') + ' \u2192 ' +
              (mg.t >= 0 ? P.actors[mg.t].label : 'off-diagram') + ' \u00b7 ' + mg.kind +
              (mg.label ? ' \u00b7 ' + mg.label : '') +
              (mg.orphan ? ' \u00b7 closed no outstanding call' : '') +
              (mg.note ? ' \u00b7 note: ' + mg.note : '');
    var labelX = 0, labelAnchor = 'middle', labelRoom = 0, endX = 0;

    if (row.isSelf) {
      var lx = col.lifeX[mg.f];
      var far = lx + M.loop;
      kids.push(mPath('M' + fin(lx) + ' ' + fin(ay) + ' H' + fin(far) +
                      ' V' + fin(ay + M.loopH) + ' H' + fin(lx + 7), lineCls));
      kids.push(pxHead(lx + 3, ay + M.loopH, -1, mg.kind));
      labelX = far + 6; labelAnchor = 'start'; labelRoom = Math.max(20, W - noteW - far - 10);
      endX = far;
    } else if (mg.t < 0 || mg.f < 0) {
      /* A message with one end in open space. The dot marks where it left the diagram or where it
         entered it; the half head says which of the two, without needing a colour to say it. */
      var lost = mg.t < 0;
      var at = lost ? mg.f : mg.t;
      var ax = col.lifeX[at];
      var dir = at < n - 1 ? 1 : -1;
      var away = ax + dir * M.lost;
      if (lost) {
        kids.push(mLine(ax + dir * 3, ay, away - dir * 5, ay, lineCls));
        kids.push(pxHead(away - dir * 5, ay, dir, 'lost'));
        kids.push(mDot(away, ay, 3, 'ck-dot'));
      } else {
        kids.push(mDot(away, ay, 3, 'ck-dot'));
        kids.push(mLine(away - dir * 3, ay, ax + dir * 3, ay, lineCls));
        kids.push(pxHead(ax + dir * 3, ay, -dir, 'found'));
      }
      labelX = (ax + away) / 2; labelRoom = M.lost - 6; endX = Math.max(ax, away);
    } else {
      var xa = col.lifeX[mg.f], xb = col.lifeX[mg.t];
      var d = xb >= xa ? 1 : -1;
      var tipX = xb - d * 3;
      kids.push(mLine(xa + d * 3, ay, tipX - d * 5, ay, lineCls));
      kids.push(pxHead(tipX, ay, d, mg.kind));
      labelX = (xa + xb) / 2; labelRoom = Math.abs(xb - xa) - 10; endX = Math.max(xa, xb);
    }

    if (mg.orphan && c.activations) {
      /* A hollow ring where a filled activation would have started. It reads as absence, which is
         exactly what an unmatched return is. */
      kids.push(mDot(col.lifeX[mg.f], ay, 3.4, 'ck-orphan'));
    }

    /* A label longer than the room between its two lifelines is CLIPPED rather than allowed to
       run across a neighbour, and the whole of it survives in the tooltip. Widening the diagram
       instead would let one sentence set the width of every column. */
    var shown = clipTo(row.full, Math.max(12, labelRoom));
    if (shown) { kids.push(mText(labelX, ay - 5, shown, 'ck-mlabel', labelAnchor)); }

    /* One fat invisible target per message, covering exactly its own row so two rows can never
       fight over a pointer: a 1.3px line is not a hit area, and the tooltip is where the
       untruncated label lives. */
    var hit = mRect(0, row.top, W, row.h, 'ck-hit');
    hit.ti = tip;
    kids.push(hit);

    marks.push({ t: 'g', a: { 'class': 'ck-m', 'data-msg': String(i + 1) }, kids: kids });

    if (row.lines.length) {
      var nx = W - noteW + 6;
      var ny = ay - 8;
      marks.push(mLine(Math.min(endX + 4, nx - 6), ay, nx, ny + 8, 'ck-leader'));
      marks.push(mRect(nx, ny, noteW - 12, row.lines.length * 11 + 8, 'ck-note', 2));
      for (k = 0; k < row.lines.length; k++) {
        marks.push(mText(nx + 5, ny + 13 + k * 11, row.lines[k], 'ck-ntext', 'start'));
      }
    }
  }

  /* The row table and the lifeline positions ride along with the drawing, so a test can ask where
     message seven's arrow landed rather than re-deriving it - a second copy of the layout would
     agree with the first by construction rather than by fact. The browser ignores both. */
  return { W: W, H: H, marks: marks, pairing: pairing, rows: rows, lifeX: col.lifeX,
           note: pxNote(P, c, pairing, kindsSeen, shortened) };
}

/**
 * One arrowhead, as the shape that carries the message's kind.
 *
 * Three heads, deliberately: a filled triangle for a synchronous call, an open V for anything the
 * sender does not block on, and a single barb for a message with one end in open space. The
 * distinction survives greyscale, which is the point — the stroke colour is reinforcement.
 *
 * @param x    the tip
 * @param dir  +1 when the arrow points right, -1 when it points left
 * @param kind the message kind
 *
 * @example pxHead(100, 40, 1, 'call').a['class'];   // 'ck-head'
 */
function pxHead(x, y, dir, kind) {
  var b = 7 * dir;
  if (kind === 'call' || kind === 'self') {
    return mPath('M' + fin(x) + ' ' + fin(y) + ' L' + fin(x - b) + ' ' + fin(y - 3.2) +
                 ' L' + fin(x - b) + ' ' + fin(y + 3.2) + ' Z', 'ck-head');
  }
  if (kind === 'lost' || kind === 'found') {
    return mPath('M' + fin(x - b) + ' ' + fin(y - 3.6) + ' L' + fin(x) + ' ' + fin(y), 'ck-open');
  }
  return mPath('M' + fin(x - b) + ' ' + fin(y - 3.6) + ' L' + fin(x) + ' ' + fin(y) +
               ' L' + fin(x - b) + ' ' + fin(y + 3.6), 'ck-open');
}

/* The browser gets exactly these, as text. They are hoisted declarations, so order is cosmetic.
   KINDS travels as a literal rather than as a shipped function, so it is spliced in separately. */
const SHIPPED = [fin, tw, clipTo, pxWrap, mLine, mText, mRect, mPath, mDot, pxConfig, pxPair,
                 pxColumns, pxMetrics, pxNote, pxRender, pxHead];

/* ── emit ────────────────────────────────────────────────────────────────────────────── */

/* The backtick is reached for rather than written, so no editing pass can turn this file into
   the thing it exists to prevent. */
const TICK_RE = new RegExp(String.fromCharCode(96), 'g');

/**
 * Serialise a value as a JavaScript literal that is safe inside an inline `<script>`.
 *
 * `<` and `>` become escapes so an actor name containing a closing script tag cannot end the
 * block early, with the useful side effect that no label can put an arrow into a file that is
 * contractually free of them.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * @example jsLit({ id: '</script>' });   // '{"id":"\\u003c/script\\u003e"}'
 */
function jsLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(TICK_RE, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** One display-list mark as SVG markup, for the copy that ships drawn inside `card.html`. */
function oneMark(m) {
  let s = '<' + m.t;
  for (const k in m.a) {
    if (Object.hasOwn(m.a, k) && m.a[k] != null && m.a[k] !== '') s += ' ' + k + '="' + CK.esc(m.a[k]) + '"';
  }
  const kids = (m.kids || []).map(oneMark).join('');
  const body = (m.s != null ? CK.esc(m.s) : '') +
               (m.ti != null ? '<title>' + CK.esc(m.ti) + '</title>' : '') + kids;
  return s + '>' + body + '</' + m.t + '>';
}

/** The whole display list as markup. */
function svgInner(marks) { return marks.map(oneMark).join(''); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-protocol[data-card="' + id + '"]';
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
 * Nothing here names a colour: every value is a desk token, so the light switch is the only thing
 * that has to know anything. `prefers-color-scheme` is deliberately absent — the desk is one
 * document open in two viewers that want different answers.
 *
 * The kinds differ in `stroke-dasharray` and in which head shape the geometry emitted, never in
 * hue alone: `--accent` here is emphasis on top of a distinction that is already carried.
 */
function cardCss(id, wide, W) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-plot .ck-dtitle', 'fill: var(--ink-dim); font-size: 10px; letter-spacing: .03em;'],
    ['.ck-plot .ck-life', 'stroke: var(--ck-grid); stroke-width: 1; stroke-dasharray: 3 4;'],
    ['.ck-plot .ck-actor', 'fill: var(--pill); stroke: var(--pill-edge); stroke-width: 1;'],
    ['.ck-plot .ck-aname', 'fill: var(--ink); font-size: 9.5px;'],

    ['.ck-plot .ck-msg', 'stroke: var(--ink-dim); stroke-width: 1.3; fill: none;'],
    ['.ck-plot .ck-dash', 'stroke-dasharray: 4 3;'],
    ['.ck-plot .ck-head', 'fill: var(--ink-dim); stroke: none;'],
    ['.ck-plot .ck-open', 'fill: none; stroke: var(--ink-dim); stroke-width: 1.3; stroke-linecap: round;'],
    ['.ck-plot .ck-dot', 'fill: var(--ink-dim); stroke: none;'],
    ['.ck-plot .ck-orphan', 'fill: none; stroke: var(--accent); stroke-width: 1.4;'],
    ['.ck-plot .ck-mlabel', 'fill: var(--ink); font-size: 9px;'],

    ['.ck-plot .ck-act', 'fill: var(--pill); stroke: var(--accent); stroke-width: 1;'],
    ['.ck-plot .ck-act-open', 'stroke-dasharray: 3 2;'],
    ['.ck-plot .ck-torn', 'fill: none; stroke: var(--accent); stroke-width: 1.2;'],

    ['.ck-plot .ck-note', 'fill: var(--well); stroke: var(--hairline); stroke-width: 1;'],
    ['.ck-plot .ck-ntext', 'fill: var(--ink-dim); font-size: 9px;'],
    ['.ck-plot .ck-leader', 'stroke: var(--hairline); stroke-width: 1; stroke-dasharray: 2 2;'],

    ['.ck-plot .ck-empty', 'fill: var(--ink-faint); font-size: 11px;'],
    ['.ck-plot .ck-hit', 'fill: none; stroke: none; pointer-events: all;'],
    ['.ck-plot .ck-m', 'transition: opacity .12s linear;'],
    ['.ck-plot:hover .ck-m', 'opacity: .5;'],
    ['.ck-plot .ck-m:hover', 'opacity: 1;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];
  if (wide) rules.push(['.ck-scroll svg.ck-plot', 'min-width: ' + Math.round(W) + 'px;']);

  /* The only animation is that fade and it carries no meaning, so it is safe to simply stop. */
  return scope(id, rules) +
    '\n@media (prefers-reduced-motion: reduce) {\n' +
    scope(id, [['.ck-plot .ck-m', 'transition: none;']]) +
    '\n}\n';
}

/** The card's markup: one section, a gear, a settings panel, the diagram drawn, and the caption. */
function cardHtml(id, title, seed, cfg, wide) {
  const f = (name) => CK.esc(id) + '-' + name;
  const box = (name, on) =>
    '    <label for="' + f(name) + '">' + CK.esc(name) + '</label>\n' +
    '    <input id="' + f(name) + '" name="' + name + '" type="checkbox"' + (on ? ' checked' : '') + '>\n';

  const plot =
    '<svg class="ck-plot" role="img" viewBox="0 0 ' + seed.W + ' ' + seed.H + '" aria-label="' +
    CK.esc(seed.note.aria) + '">' + svgInner(seed.marks) + '</svg>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-protocol">\n' +
    '  <h2>' + CK.esc(title) + '</h2>\n' +
    '  <button class="ck-gear" type="button" title="settings" aria-label="protocol settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    box('numbering', cfg.numbering) +
    box('activations', cfg.activations) +
    box('compact', cfg.compact) +
    '    <p class="ck-set-foot">numbering settles which of two nearly-touching arrows came first. ' +
         'activation bars are derived from the call and return pairing, so an unbalanced protocol ' +
         'shows a torn bar or a hollow ring rather than a tidy picture; switching them off hides ' +
         'the marks but not the counts, which stay in the caption.</p>\n' +
    '  </div>\n' +
    '  ' + (wide ? '<div class="ck-scroll">' + plot + '</div>' : plot) + '\n' +
    '  <div class="ck-cap">' + seed.note.caption + '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: the shipped renderer, a display-list translator, and the settings wiring.
 *
 * Built by concatenation, never by a template literal, and passed through {@link guardEmitted}
 * before it is returned — so a backtick that got into a doc comment cannot reach the page, where
 * it would close the desk's one inline script block early and blank every card on it.
 *
 * @returns the script body
 * @throws {Error} from the guard, naming the construct and its offset
 */
function cardJs(id, payload, cfg) {
  const src =
    '/* protocol card: the same renderer that drew the copy in card.html, re-run when a setting\n' +
    '   changes. The call and return pairing is redone here too, so the activation bars and the\n' +
    '   counts in the caption cannot disagree about what was left open. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NS = "http://www.w3.org/2000/svg";\n' +
    '  var P = ' + jsLit(payload) + ';\n' +
    '  var DEFAULTS = ' + jsLit(cfg) + ';\n' +
    '  var KINDS = ' + jsLit(KINDS) + ';\n' +
    '\n' +
    '  var plot = sec.querySelector("svg.ck-plot");\n' +
    '  var cap  = sec.querySelector(".ck-cap");\n' +
    '  if (!plot) { return; }\n' +
    '\n' +
    '  ' + SHIPPED.map((fn) => fn.toString()).join('\n\n').split('\n').join('\n  ') + '\n' +
    '\n' +
    '  /* One display-list entry as a real element. The attribute names are the SVG ones, so this\n' +
    '     stays a translator rather than a second place where diagram decisions live. */\n' +
    '  function node(m) {\n' +
    '    var e = document.createElementNS(NS, m.t), a = m.a, k, i, tip;\n' +
    '    for (k in a) { if (Object.hasOwn(a, k) && a[k] != null && a[k] !== "") { e.setAttribute(k, a[k]); } }\n' +
    '    if (m.s != null) { e.textContent = m.s; }\n' +
    '    if (m.ti != null) {\n' +
    '      tip = document.createElementNS(NS, "title");\n' +
    '      tip.textContent = m.ti;\n' +
    '      e.appendChild(tip);\n' +
    '    }\n' +
    '    if (m.kids) { for (i = 0; i < m.kids.length; i++) { e.appendChild(node(m.kids[i])); } }\n' +
    '    return e;\n' +
    '  }\n' +
    '\n' +
    '  /* A repaint, not an append: the desk swaps its main element and replays every builder, so\n' +
    '     a render that added marks would draw a second diagram on top of the first. */\n' +
    '  function render(conf) {\n' +
    '    var out = pxRender(P, conf), i;\n' +
    '    while (plot.firstChild) { plot.removeChild(plot.firstChild); }\n' +
    '    plot.setAttribute("viewBox", "0 0 " + out.W + " " + out.H);\n' +
    '    plot.setAttribute("aria-label", out.note.aria);\n' +
    '    for (i = 0; i < out.marks.length; i++) { plot.appendChild(node(out.marks[i])); }\n' +
    '    /* The caption is markup whose every data-derived value was escaped as it was built. */\n' +
    '    if (cap) { cap.innerHTML = out.note.caption; }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, DEFAULTS, render);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/protocol');
}

/**
 * Build one sequence-diagram card from one data block.
 *
 * WHAT THIS TOOK FROM `src/ts/diagrams` IN THE MAIN REPOSITORY, AND WHAT IT LEFT.
 *
 * Taken, from the MODEL (`model.ts`) and from the shape of `renderSequence`:
 *
 *   - What a message is. `{ from, to, label }` with `to` allowed to equal `from`, exactly as
 *     `SequenceMessage` and `DiagramEdge` define it; `kind` and `note` are additions, not a
 *     redefinition.
 *   - How actors are ordered. An explicit list fixes the columns left to right; an absent list
 *     infers them from message endpoints in FIRST-APPEARANCE order. That is `normalizeGraph`'s
 *     rule verbatim, and it is the right one — first appearance is the order the author wrote,
 *     and any other order would be the renderer having an opinion about the protocol.
 *   - The validation vocabulary: unique ids, no dangling endpoint, and an endpoint that names
 *     nothing is an error rather than a new participant.
 *   - The row discipline: messages are placed strictly in input order, top to bottom, one row
 *     each, with no layout search. `renderSequence` is explicit that this is what makes a
 *     sequence diagram mechanical to render, and it is right.
 *   - The gap-widening idea: an adjacent column gap grows to fit the labels of the messages that
 *     span it. `renderSequence` widens for messages whose LEFT end is the previous column; this
 *     generalises it to any span by charging the deficit to the span's last gap.
 *
 * Left behind, deliberately:
 *
 *   - The renderer itself. Every line of it is character-cell bound — `boxW = actor.length + 4`,
 *     `makeGrid`, `drawVline`, `expandWaypoints` — and none of that survives contact with
 *     proportional pixels and an SVG surface.
 *   - `requireGridSafe`. It exists to keep a monospace grid aligned, so it rejects emoji, CJK and
 *     combining marks. On an SVG surface those are simply text, and a card that refused a CJK
 *     actor name would be worse than the one that draws it.
 *   - Throwing. `renderSequence` raises a `RangeError` for an empty actor list, a duplicate id,
 *     an unknown endpoint or an overflowing width, which is correct for a function whose caller
 *     can fix the input. A card is handed data by a desk and must still draw, so each of those
 *     becomes a refusal that is counted and named in the caption instead.
 *   - The width budget as a hard failure. Here the drawing scrolls inside `.ck-scroll` and, past
 *     the budget, shortens labels once rather than refusing to render.
 *
 * UNMATCHED CALLS AND RETURNS. Nothing is balanced silently. A `call` pushes an activation onto
 * its target and a `return` pops its sender's topmost open one. A call still open when the
 * messages run out keeps its bar, which runs to the foot of the diagram and ends in a torn edge
 * rather than a straight one; a return that finds nothing to pop is drawn as it happened and gets
 * a hollow ring at its tail. Both are counted, and the caption states both counts in bold — even
 * when activation bars are switched off, because the imbalance is a fact about the protocol
 * rather than a property of the drawing.
 *
 * Degenerate inputs and what they draw:
 *
 *   no actors            a card-sized empty frame saying so; nothing is invented
 *   one actor            one column and one lifeline; self-messages loop off it and every other
 *                        message is refused for naming an unknown second party
 *   unknown actor        that message alone is refused, counted, and named in the caption
 *   zero messages        actors and lifelines still draw, and the caption says nothing travels
 *   50 messages          50 rows; the diagram grows downward, which is how it is read
 *   a self-message       a right-hand loop off the sender's own lifeline
 *   crossing messages    drawn crossing; order is the vertical axis and is never reordered to
 *                        avoid a crossing, because that would falsify the sequence
 *   a very long label    clipped to the room it has, with the full text in the tooltip
 *   unmatched call       a bar to the foot of the diagram with a torn edge, counted and named
 *   unmatched return     drawn, with a hollow ring at the tail, counted and named
 *   duplicate actor ids  the first column wins, the repeats are dropped and counted
 *
 * @param id    the card's identity; becomes its `data-card`, its CSS scope and its settings key
 * @param title the heading, in the card's own words
 * @param data  `{ actors, messages, title }` — see {@link meta}
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` — `json` is the card's `card.json` as an object, the other
 *          three are file bodies ready to write beside it
 *
 * @throws {Error} when the geometry produces a non-finite coordinate, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({
 *   id: 'handshake',
 *   title: 'token exchange',
 *   data: { actors: [{ id: 'app' }, { id: 'auth' }],
 *           messages: [{ from: 'app', to: 'auth', label: 'POST /token', kind: 'call' },
 *                      { from: 'auth', to: 'app', label: '200 access_token', kind: 'return' }] },
 *   ord: 40,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'protocol' : id);
  const P = readData(data);
  const cfg = { ...defaults };

  const seed = pxRender(P, cfg);
  const wide = seed.W > W0;

  /* The payload the browser re-renders from carries the data and the budgets and no geometry, so
     the two runtimes cannot disagree about anything except the config. */
  const payload = {
    actors: P.actors,
    msgs: P.msgs.map((m) => ({ f: m.f, t: m.t, kind: m.kind, label: m.label, note: m.note })),
    title: P.title,
    refused: P.refused, dupActors: P.dupActors,
    droppedActors: P.droppedActors, droppedMsgs: P.droppedMsgs,
    W0, WMAX,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      actors: P.actors.length,
      messages: P.msgs.length,
      refusedMessages: P.refused.length,
      duplicateActorIds: P.dupActors.length,
      unmatchedCalls: seed.pairing.unclosed,
      unmatchedReturns: seed.pairing.orphans,
      settings: { ...cfg },
    },
    html: cardHtml(cardId, title == null ? cardId : String(title), seed, cfg, wide),
    css:  cardCss(cardId, wide, seed.W),
    js:   cardJs(cardId, payload, cfg),
  };
}

/* Exported for the type's own verification, which executes the geometry rather than only reading
   it: a static check can prove the script parses and cannot prove an activation bar starts on the
   right message. */
export const _internals = { readData, pxRender, pxPair, pxConfig, pxColumns, pxWrap, SHIPPED, KINDS };
