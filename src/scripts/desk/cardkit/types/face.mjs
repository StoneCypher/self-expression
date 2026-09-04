/**
 * @file cardkit card type: `face` — Claude's recorded affect signature, drawn as a face.
 *
 * John built the affect signature as a face-substitute: a legible channel for internal state,
 * because there is no face. This card is the substitute rendered back as one. It reads no
 * database; a caller hands it rows out of `~/.claude/affect-log.sqlite3` and it draws the
 * newest one.
 *
 * ## The one rule everything else serves
 *
 * **The drawing is a pure function of `(face, delta, uncertain)`, and of nothing else.** Not of
 * `text`, not of `context`, not of `cctype`. The mapping is the literal table at {@link LOOKS},
 * one row per emoji, each with its drawing parameters written out. An emoji that is not in the
 * table does not get guessed at — it rests, visibly and distinguishably.
 *
 * The temptation this forecloses is worth naming, because it is a good-looking temptation: a
 * card that read the prose could produce far richer micro-expression, and every bit of it would
 * be affect that was never reported. Fluent, convincing, and unfalsifiable — a forgery of exactly
 * the signal this channel exists to carry. Worse than no face. So the drawing parameters are
 * dumped verbatim into `data-look` on the `<svg>`, where two cards can be diffed byte for byte,
 * and the source row is printed beside the drawing so a reader can check one against the other.
 *
 * ## What is a face and what is not
 *
 * `uncertain` is not an affect — it is a statement *about* an affect, and every facial candidate
 * for it (a frown, a squint) reads as some different emotion instead of as a confidence interval.
 * So it gets a non-facial channel: the whole drawing is printed **twice, slightly out of
 * register**, inside a **broken ring**. Registration error is what a machine does when it cannot
 * get a clean read, and it carries no emotional reading at all.
 *
 * `delta` is the same kind of thing — a comparison against the previous row, not a feeling. Raised
 * brows read as surprise, never as "better than last time". So delta is also non-facial: it lives
 * on the **valence track** under the face, where a hollow mark is the previous row's declared
 * valence, a filled mark is this row's, and an arrowhead on the filled mark is the delta **as
 * recorded**. The gap between the marks and the arrowhead are separate claims; when they disagree,
 * that disagreement is visible, which is the point. A first row has no hollow mark and — when it
 * recorded no delta — no arrowhead either, rather than being drawn as steady.
 *
 * ## Staleness
 *
 * A signature is two events an hour apart; a drawing is continuous. Most of what a viewer sees is
 * therefore the gap, and a held expression across that gap asserts a present state that was never
 * recorded. So the card fades as its warrant ages and goes **quiet** past `staleMins`.
 *
 * What decays is the card's warrant, never the recorded affect — so the fade is applied to the
 * drawing's *presence* (opacity) and the expression's *geometry* never blends. It is the recorded
 * expression at full strength, the same expression fading, or rest. Nothing in between, because an
 * expression half-way between a frown and rest is an affect nobody reported.
 *
 * Quiet is **not** a recorded neutral, and the two must never look alike. Quiet draws dashes for
 * eyes and a short dash for a mouth; a recorded neutral keeps round eyes and a full-width mouth;
 * an unrecognised emoji rests with small dots and no mouth at all. Three different nothings, three
 * different pictures.
 *
 * The static markup ships in the **quiet** state and the browser script promotes it only after
 * checking a real clock. A card whose script never runs therefore claims nothing, which is the
 * correct way for this particular card to fail.
 *
 * @see LOOKS   the mapping table, and the only place expression is decided
 * @see meta    the type's name, category and settings
 * @see ../CONTRACT.md
 */

/* ── the geometry, in one place ─────────────────────────────────────────────────────────────
   Named rather than inlined so the drawing functions read as anatomy instead of as arithmetic,
   and so a change to the face's proportions is one edit. All in viewBox units. */

/** The drawing surface. Tall enough for the face and the valence track beneath it. */
const BOX = '0 0 200 206';

const CX = 100;      /** face centre, x */
const CY = 88;       /** face centre, y */
const RING = 68;     /** the bezel radius */
const EYE_Y = 78;    /** eye centreline */
const EYE_DX = 24;   /** eye offset from centre */
const BROW_Y = 60;   /** brow centreline */
const MOUTH_Y = 112; /** mouth centreline */
const MOUTH_HW = 22; /** mouth half-width at full extent */
const TRACK_Y = 188; /** the valence track */
const TRACK_HALF = 64;

/**
 * One row of the mapping table, with every drawing parameter defaulted.
 *
 * Written as a helper so a table row states only what makes that face *different*, which is the
 * property that makes the table auditable at a glance: anything a row does not say is rest.
 *
 * @param name  the look's id — appears in `data-look` and in the accessible label
 * @param o     the parameters this face overrides
 * @returns a complete look
 *
 * @example L('neutral', { mouth: 'flat', valence: 0 }).eye;   // 'open'
 */
const L = (name, o) => ({
  name,
  eye: 'open',       /* open | wide | narrow | closed | up | down | dash | dot            */
  mouth: 'curve',    /* curve | flat | none | o | open | grid | dash                      */
  curve: 0,          /* -1 deep frown .. +1 broad smile                                   */
  skew: 0,           /* -1 .. +1, sideways pull on the mouth                              */
  brow: 0,           /* -1 inner ends down (tension) .. +1 inner ends up (worry)          */
  tilt: 0,           /* head tilt, degrees                                                */
  bead: 0,           /* the sweat bead, 0 or 1                                            */
  valence: 0,        /* declared position on the valence track, -1 .. +1, or null         */
  arousal: 0.35,     /* 0 .. 1; drives only the idle motion's amplitude and period        */
  ...o,
});

/**
 * The mapping table: recorded face emoji to drawing parameters.
 *
 * **This is the whole of the expression logic.** Nothing else in this file decides how a face
 * looks, and nothing anywhere reads the signature's prose. Adding an emoji is one row here;
 * removing one makes it rest. Keys are stored with variation selectors already stripped, so
 * `☹️` is filed under its bare U+2639.
 *
 * `valence` is a *declared* position, not a derived one — it is written down per row precisely so
 * that it is arguable. If a row's valence looks wrong, that is a disagreement about this table and
 * can be had here, rather than a disagreement with an inference nobody can see.
 *
 * @example LOOKS['\u{1F610}'].mouth;   // 'flat' — neutral keeps a full-width flat mouth
 */
export const LOOKS = {
  /* ── the good end ─────────────────────────────────────────────────────────────────────── */
  '🙂': L('slight-smile',  { curve:  0.45, valence:  0.45 }),
  '😊': L('warm',          { eye: 'up', curve: 0.60, valence: 0.65, arousal: 0.40 }),
  '😀': L('grin',          { mouth: 'open', curve: 0.85, valence: 0.80, arousal: 0.55 }),
  '😃': L('grin-wide',     { eye: 'wide', mouth: 'open', curve: 0.90, valence: 0.85, arousal: 0.60 }),
  '😄': L('beam',          { eye: 'up', mouth: 'open', curve: 0.95, valence: 0.88, arousal: 0.60 }),
  '😁': L('beam-teeth',    { eye: 'up', mouth: 'grid', valence: 0.80, arousal: 0.60 }),
  '🤩': L('starstruck',    { eye: 'wide', mouth: 'open', curve: 0.90, valence: 0.90, arousal: 0.85 }),
  '😌': L('content',       { eye: 'closed', curve: 0.35, valence: 0.50, arousal: 0.15 }),
  '😇': L('earnest',       { eye: 'up', curve: 0.50, valence: 0.60, arousal: 0.30 }),
  '🥲': L('smile-tear',    { curve: 0.45, bead: 1, valence: 0.10, arousal: 0.40 }),

  /* ── sideways ─────────────────────────────────────────────────────────────────────────── */
  '🙃': L('wry',           { curve: 0.40, tilt: 14, valence: 0.25 }),
  '😏': L('smirk',         { eye: 'narrow', curve: 0.35, skew: -0.70, valence: 0.30, arousal: 0.30 }),
  '🤨': L('one-brow-up',   { eye: 'narrow', mouth: 'flat', skew: -0.40, brow: -0.30, valence: -0.10, arousal: 0.40 }),

  /* ── the flat middle. Three genuinely different flats, and they draw differently. ─────── */
  '😐': L('neutral',       { mouth: 'flat', valence: 0, arousal: 0.25 }),
  '😑': L('expressionless',{ eye: 'dash', mouth: 'flat', valence: -0.20, arousal: 0.20 }),
  '😶': L('no-mouth',      { mouth: 'none', valence: -0.05, arousal: 0.20 }),

  /* ── working ──────────────────────────────────────────────────────────────────────────── */
  '🤔': L('thinking',      { eye: 'narrow', curve: 0.10, skew: -0.55, brow: -0.30, tilt: 7, valence: 0, arousal: 0.40 }),
  '🧐': L('scrutiny',      { eye: 'narrow', mouth: 'flat', brow: -0.35, tilt: 5, valence: 0, arousal: 0.40 }),
  '😤': L('determined',    { eye: 'narrow', mouth: 'flat', brow: -0.70, valence: -0.15, arousal: 0.75 }),

  /* ── strain ───────────────────────────────────────────────────────────────────────────── */
  '😬': L('grimace',       { mouth: 'grid', brow: -0.50, valence: -0.40, arousal: 0.70 }),
  '😅': L('nervous-smile', { curve: 0.50, brow: -0.40, bead: 1, valence: 0.05, arousal: 0.65 }),
  '😓': L('sweat-down',    { eye: 'down', curve: -0.35, brow: 0.35, bead: 1, valence: -0.50, arousal: 0.55 }),
  '😰': L('anxious',       { eye: 'wide', curve: -0.50, brow: 0.50, bead: 1, valence: -0.70, arousal: 0.80 }),
  '😟': L('worried',       { eye: 'wide', curve: -0.40, brow: 0.50, valence: -0.50, arousal: 0.55 }),

  /* ── the bad end ──────────────────────────────────────────────────────────────────────── */
  '😕': L('slight-frown',  { curve: -0.35, brow: 0.20, valence: -0.35, arousal: 0.30 }),
  '🙁': L('frown',         { curve: -0.50, brow: 0.30, valence: -0.50, arousal: 0.30 }),
  '☹':  L('frown-deep',    { curve: -0.60, brow: 0.35, valence: -0.60, arousal: 0.35 }),
  '😔': L('pensive',       { eye: 'down', curve: -0.40, brow: 0.35, valence: -0.55, arousal: 0.20 }),
  '😞': L('dejected',      { eye: 'down', curve: -0.55, brow: 0.40, valence: -0.65, arousal: 0.25 }),
  '😢': L('crying',        { eye: 'down', curve: -0.50, brow: 0.45, bead: 1, valence: -0.70, arousal: 0.50 }),
  '😩': L('weary',         { eye: 'closed', mouth: 'open', curve: -0.60, brow: 0.45, valence: -0.70, arousal: 0.50 }),
  '😫': L('tired-out',     { eye: 'closed', mouth: 'open', curve: -0.70, brow: 0.40, valence: -0.75, arousal: 0.45 }),
  '😠': L('annoyed',       { eye: 'narrow', curve: -0.50, brow: -0.85, valence: -0.70, arousal: 0.80 }),
  '😡': L('angry',         { eye: 'narrow', curve: -0.60, brow: -1.00, valence: -0.85, arousal: 0.90 }),

  /* ── low power and startle ────────────────────────────────────────────────────────────── */
  '🥱': L('yawn',          { eye: 'closed', mouth: 'o', valence: -0.10, arousal: 0.10 }),
  '😴': L('asleep',        { eye: 'closed', mouth: 'flat', valence: 0, arousal: 0.05 }),
  '😮': L('surprise',      { eye: 'wide', mouth: 'o', brow: 0.55, valence: 0.05, arousal: 0.80 }),
  '😲': L('astonished',    { eye: 'wide', mouth: 'o', brow: 0.65, valence: 0.05, arousal: 0.90 }),
};

/**
 * What an unrecognised face draws.
 *
 * Two small dots and no mouth: an instrument with nothing to report. `valence` is `null` on
 * purpose — an unknown emoji has no declared position, and putting its mark at zero would
 * silently assert neutral valence, which is exactly the invention the table exists to prevent.
 *
 * It must not be confusable with `😐`, which is a recorded neutral and keeps round eyes and a
 * full-width flat mouth, nor with {@link QUIET}, which uses dashes.
 */
const REST = L('rest', { eye: 'dot', mouth: 'none', valence: null, arousal: 0.18 });

/**
 * What a stale card draws: dashes for eyes, a short dash for a mouth, a dotted bezel.
 *
 * Deliberately not `REST` and deliberately not `😐`. Quiet means the card has stopped claiming a
 * present state, which is a different fact from "nothing was recorded" and from "calm was
 * recorded", and three different facts must not share one picture.
 */
const QUIET = L('quiet', { eye: 'dash', mouth: 'dash', valence: null, arousal: 0 });

/**
 * Every setting the card understands, with its fallback.
 *
 * `freshMins` is how long a signature is drawn at full strength; between there and `staleMins`
 * the drawing fades without changing shape; past `staleMins` it goes quiet. 15 and 45 because a
 * working turn produces a signature every few minutes, so three quarters of an hour with nothing
 * means the session ended or went silent — and because a fixed, named threshold is falsifiable in
 * a way an adaptive one (a rolling median gap, say) never is. A threshold that means something
 * different on different days cannot be argued with.
 *
 * `idle` turns off the drifting breath, which is decoration and says nothing.
 */
export const defaults = { freshMins: 15, staleMins: 45, idle: true };

/**
 * What this card type is, for the desk's picker and for tooling.
 *
 * `live-and-ambient` — "what is true right now?" — and the category is doing work rather than
 * filing: it is the reason this card draws only the newest row. A card that drew the whole of
 * `rows` would be answering "what changed over time?", which is `evolution` and is a different
 * card. Everything older than the newest row is here to supply the delta's referent and nothing
 * else.
 *
 * @example meta.category;   // 'live-and-ambient'
 */
export const meta = {
  name: 'face',
  summary: 'Claude\u2019s newest recorded affect signature, drawn as an abstract face that goes quiet when it goes stale.',
  shape: '{ rows: [{ at, position, delta, uncertain, face, context, cctype, text, need }], now } ' +
         '\u2014 at an ISO string or epoch ms, delta "up" | "down" | "steady" | an arrow emoji | null, ' +
         'face one emoji, now optional epoch ms pinning the build clock',
  category: 'live-and-ambient',
  defaults: { ...defaults },
};

/* ── small helpers ──────────────────────────────────────────────────────────────────────── */

/**
 * HTML-escape a build-time value. Mirrors `CK.esc` so markup produced here and markup produced in
 * the browser cannot disagree about what is safe.
 *
 * Control characters are dropped before escaping rather than after, because they are invisible in
 * an attribute and escaping does not remove them. Compared numerically instead of matched against
 * a character class: writing the class is how the class gets corrupted.
 *
 * @example esc('a<b & "c"');   // 'a&lt;b &amp; &quot;c&quot;'
 */
function esc(s) {
  const raw = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) continue;
    out += raw.charAt(i);
  }
  return out
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JSON literal safe to paste into a classic `<script>` body.
 *
 * `JSON.stringify` alone is not enough: a value containing `</script` closes the element early and
 * the rest of the deck renders as text. The two line separators are newlines to a JS parser but
 * not to JSON, so they go too.
 *
 * The question mark goes too, so a label reading "ready?.no" cannot look like optional chaining
 * to a guard that scans raw text. It decodes back to itself, so no rendered text changes.
 *
 * So does the backtick, reached for by code point rather than typed. The emitted script is a
 * classic script, and one backtick arriving from data opens a template literal that never
 * closes -- a parse error in the single inline block every card's script shares, so it blanks
 * the whole desk rather than this one card.
 *
 * @example jsJson({ a: '</script>' });   // '{"a":"\\u003c/script\\u003e"}'
 */
function jsJson(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(new RegExp(String.fromCharCode(96), 'g'), '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Two decimal places, so emitted path data stays short and two builds diff cleanly. */
function n2(v) { return Math.round(v * 100) / 100; }

/** Presentation selectors. Removed before a table lookup: they change nothing but the font. */
const VARIATION = /[\uFE0E\uFE0F]/g;

/**
 * Normalise a recorded `face` field into a table key.
 *
 * Two things happen and neither is a guess. Variation selectors are stripped, because U+FE0F is a
 * font hint rather than a different character. And a leading `❓` is peeled off and reported,
 * because the signature format writes uncertainty as a prefix on the face — so a row that carries
 * the notation instead of the boolean is read the way the format defines it, not ignored.
 *
 * A ZWJ sequence is *not* reduced to its base character. `😶‍🌫️` is not `😶`, and truncating it
 * would be inference dressed as normalisation; it simply misses the table and rests.
 *
 * @param raw the `face` field, which may be absent, empty or anything at all
 * @returns `{ key, flagged }` — the lookup key, and whether the `❓` prefix was present
 *
 * @example normFace('\u2639\uFE0F');   // { key: '\u2639', flagged: false }
 * @example normFace('\u2753\u{1F62C}');  // { key: '\u{1F62C}', flagged: true }
 */
function normFace(raw) {
  let s = String(raw == null ? '' : raw).replace(VARIATION, '').trim();
  let flagged = false;
  while (s.length && (s.charCodeAt(0) === 0x2753 || s.charCodeAt(0) === 0x2754)) {
    flagged = true;
    s = s.slice(1).trim();
  }
  return { key: s, flagged };
}

/** The delta vocabulary: what the logger writes, and what the signature line writes. */
const DELTAS = {
  up: 'up', down: 'down', steady: 'steady',
  '\u2B06': 'up', '\u2B07': 'down', '\u27A1': 'steady',
};

/**
 * Normalise a recorded `delta` into `up`, `down`, `steady` or nothing.
 *
 * Absent is a legitimate value — a session's first signature has no delta — and is reported as
 * recognised with a null direction, because "there was none" and "there was one and I could not
 * read it" must not collapse into the same state. The second is reported as unrecognised, counted,
 * and named on the card.
 *
 * @param raw the `delta` field
 * @returns `{ delta, known }`
 *
 * @example normDelta('\u2B06\uFE0F');   // { delta: 'up', known: true }
 * @example normDelta(null);             // { delta: null, known: true }
 * @example normDelta('sideways');       // { delta: null, known: false }
 */
function normDelta(raw) {
  if (raw == null) return { delta: null, known: true };
  const s = String(raw).replace(VARIATION, '').trim().toLowerCase();
  if (s === '') return { delta: null, known: true };
  if (Object.hasOwn(DELTAS, s)) return { delta: DELTAS[s], known: true };
  return { delta: null, known: false };
}

/**
 * A row's instant, in epoch milliseconds, or `null` when it cannot be read.
 *
 * Refuses rather than coerces. A number is epoch **milliseconds** and nothing else: a value that
 * might be seconds is not silently multiplied, because a card that guesses the unit draws a row
 * from 1970 or from the year 57000 and looks entirely confident doing it.
 *
 * @param v the `at` field
 * @returns milliseconds, or null
 *
 * @example parseAt('2026-08-29T17:00:00Z');   // 1787072400000
 * @example parseAt(Infinity);                 // null
 * @example parseAt('whenever');               // null
 */
function parseAt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * The drawing parameters for one row. **The whole of the expression logic.**
 *
 * Its arguments are the entire input: a table key, a normalised delta and a boolean. It cannot see
 * `text`, `context`, `cctype`, `at` or anything else, which is what makes the honesty rule a
 * property of the code rather than a promise about it — two rows with the same three values
 * produce the same object, byte for byte, whatever they say.
 *
 * @param key       a normalised face emoji; anything not in {@link LOOKS} rests
 * @param delta     `up`, `down`, `steady` or null
 * @param uncertain whether the reading was marked doubtful
 * @returns a complete look, plus the non-facial `needle`, `ring` and `uncertain` channels
 *
 * @example look('\u{1F642}', 'up', false).needle;    // 'up'
 * @example look('not-an-emoji', null, false).name;   // 'rest'
 * @example look('\u{1F610}', null, true).ring;       // 'dash'
 */
export function look(key, delta, uncertain) {
  const base = Object.hasOwn(LOOKS, key) ? LOOKS[key] : REST;
  const unc = uncertain ? 1 : 0;
  return {
    ...base,
    known: base !== REST,
    uncertain: unc,
    ring: unc ? 'dash' : 'solid',
    needle: delta === 'up' ? 'up' : delta === 'down' ? 'down' : delta === 'steady' ? 'level' : 'none',
  };
}

/**
 * A look as one printable line, for `data-look` on the `<svg>`.
 *
 * This is the audit surface. Every parameter that reaches the drawing appears here and nothing
 * else does — no timestamp, no staleness, no text — so two cards whose signature rows agree on
 * `(face, delta, uncertain)` carry byte-identical strings, and a card that ever started reading
 * prose would show it here immediately.
 *
 * Printable separators throughout: a separator only has to not collide, and a visible one is
 * checkable in a way an invisible one is not.
 *
 * @example lookKey(look('\u{1F610}', null, false)).slice(0, 14);   // 'look=neutral;e'
 */
export function lookKey(o) {
  return [
    'look=' + o.name,
    'eye=' + o.eye,
    'mouth=' + o.mouth,
    'curve=' + n2(o.curve),
    'skew=' + n2(o.skew),
    'brow=' + n2(o.brow),
    'tilt=' + n2(o.tilt),
    'bead=' + o.bead,
    'valence=' + (o.valence === null ? 'none' : n2(o.valence)),
    'arousal=' + n2(o.arousal),
    'ring=' + o.ring,
    'needle=' + o.needle,
    'uncertain=' + o.uncertain,
  ].join(';');
}

/* ── the drawing ────────────────────────────────────────────────────────────────────────── */

/** One eye, as markup. Eight kinds, and each one has to be tellable from the other seven. */
function eyeMark(cx, cy, kind) {
  const x = n2(cx), y = n2(cy);
  if (kind === 'dot')    return '<circle class="ck-face-ink" cx="' + x + '" cy="' + y + '" r="3"/>';
  if (kind === 'wide')   return '<circle class="ck-face-ink" cx="' + x + '" cy="' + y + '" r="7"/>' +
                                '<circle class="ck-face-eyering" cx="' + x + '" cy="' + y + '" r="11"/>';
  if (kind === 'narrow') return '<ellipse class="ck-face-ink" cx="' + x + '" cy="' + y + '" rx="7.5" ry="3.2"/>';
  if (kind === 'closed') return '<path class="ck-face-thin" d="M ' + n2(cx - 8) + ' ' + n2(cy - 2) + ' q 8 8 16 0"/>';
  if (kind === 'up')     return '<path class="ck-face-thin" d="M ' + n2(cx - 8) + ' ' + n2(cy + 3) + ' q 8 -9 16 0"/>';
  if (kind === 'down')   return '<path class="ck-face-ink" d="M ' + n2(cx - 7.5) + ' ' + n2(cy - 1) +
                                ' a 7.5 7.5 0 0 1 15 0 Z"/>';
  if (kind === 'dash')   return '<path class="ck-face-thin" d="M ' + n2(cx - 8) + ' ' + y + ' L ' + n2(cx + 8) + ' ' + y + '"/>';
  return '<circle class="ck-face-ink" cx="' + x + '" cy="' + y + '" r="6.5"/>';   /* open */
}

/**
 * The mouth.
 *
 * A smile is a `∪` and a frown is a `∩`: with screen y growing downward, `curve > 0` lifts the
 * corners (smaller y) and drops the control point, which is the shape people actually draw. The
 * two closed kinds — `open` and `grid` — are filled with the well colour so they read as a gap in
 * the face rather than as a heavy stroke.
 */
function mouthMark(o) {
  const x0 = CX - MOUTH_HW, x1 = CX + MOUTH_HW;
  if (o.mouth === 'none') return '';
  if (o.mouth === 'flat') return '<path class="ck-face-line" d="M ' + x0 + ' ' + MOUTH_Y + ' L ' + x1 + ' ' + MOUTH_Y + '"/>';
  if (o.mouth === 'dash') return '<path class="ck-face-line" d="M ' + (CX - 11) + ' ' + MOUTH_Y + ' L ' + (CX + 11) + ' ' + MOUTH_Y + '"/>';
  if (o.mouth === 'o')    return '<ellipse class="ck-face-fill" cx="' + CX + '" cy="' + MOUTH_Y + '" rx="9" ry="12"/>';
  if (o.mouth === 'grid') {
    return '<path class="ck-face-fill" d="M ' + x0 + ' 104 L ' + x1 + ' 104 L ' + x1 + ' 120 L ' + x0 + ' 120 Z"/>' +
           '<path class="ck-face-thin" d="M 89 104 L 89 120 M 100 104 L 100 120 M 111 104 L 111 120"/>';
  }
  const ends = n2(MOUTH_Y - o.curve * 8);
  const ctlX = n2(CX + o.skew * 14);
  const ctlY = n2(MOUTH_Y + o.curve * 30);
  const d = 'M ' + x0 + ' ' + ends + ' Q ' + ctlX + ' ' + ctlY + ' ' + x1 + ' ' + ends;
  return o.mouth === 'open'
    ? '<path class="ck-face-fill" d="' + d + ' Z"/>'
    : '<path class="ck-face-line" d="' + d + '"/>';
}

/**
 * The brows, or nothing.
 *
 * Below a threshold they are omitted entirely rather than drawn flat: a pair of level brows on
 * every face is noise, and their absence is the calmer picture as well as the more honest one.
 * `brow > 0` raises the inner ends (worry); `brow < 0` drops them toward the nose (tension).
 */
function browMarks(o) {
  if (Math.abs(o.brow) < 0.15) return '';
  const outer = n2(BROW_Y + o.brow * 5);
  const inner = n2(BROW_Y - o.brow * 7);
  return '<path class="ck-face-brow" d="M 66 ' + outer + ' L 88 ' + inner +
         ' M 134 ' + outer + ' L 112 ' + inner + '"/>';
}

/**
 * One complete face, bezel included.
 *
 * When the look is uncertain the whole set of features is emitted twice, the first copy nudged
 * out of register. That is the confidence channel: a print that will not line up, which reads as
 * an instrument that cannot get a clean fix and does not read as any emotion at all.
 *
 * @param o a look from {@link look}, or {@link QUIET}
 * @returns markup for the bezel, the ghost copy if any, the features, and the bead
 */
function faceGroup(o) {
  const feats = eyeMark(CX - EYE_DX, EYE_Y, o.eye) + eyeMark(CX + EYE_DX, EYE_Y, o.eye) +
                browMarks(o) + mouthMark(o);
  const body = o.tilt ? '<g transform="rotate(' + n2(o.tilt) + ' ' + CX + ' ' + CY + ')">' + feats + '</g>' : feats;
  const ringCls = o.ring === 'dash' ? ' is-dash' : o.ring === 'dot' ? ' is-dot' : '';
  const ring = '<circle class="ck-face-ring' + ringCls + '" cx="' + CX + '" cy="' + CY + '" r="' + RING + '"/>';
  const ghost = o.uncertain ? '<g class="ck-face-ghost" transform="translate(2.8 -2)">' + body + '</g>' : '';
  const bead = o.bead ? '<circle class="ck-face-bead" cx="146" cy="46" r="4.6"/>' : '';
  return ring + ghost + body + bead;
}

/**
 * The valence track: where this row sits, where the previous one sat, and the recorded delta.
 *
 * Three separate claims kept separate on purpose. The filled mark and the hollow mark are the two
 * rows' *declared* valences out of {@link LOOKS}; the arrowhead is the delta exactly **as
 * recorded**, never derived from the gap between them. When they disagree — a delta of `up`
 * between two rows of equal valence, say — the disagreement is on the card, which is the whole
 * reason for not deriving one from the other.
 *
 * A face with no declared valence (an unrecognised emoji) gets no mark at all rather than a mark
 * at zero, because a mark at zero is an assertion of neutrality nobody made.
 *
 * @param cur    this row's valence, or null
 * @param prev   the previous row's valence, or null when there is no previous row or it is unknown
 * @param needle `up`, `down`, `level` or `none`
 */
function axisGroup(cur, prev, needle) {
  const y = TRACK_Y;
  let out =
    '<path class="ck-face-track" d="M 36 ' + y + ' L 164 ' + y + '"/>' +
    '<path class="ck-face-tick" d="M 36 ' + (y - 5) + ' L 36 ' + (y + 5) +
    ' M 100 ' + (y - 3) + ' L 100 ' + (y + 3) +
    ' M 164 ' + (y - 5) + ' L 164 ' + (y + 5) + '"/>' +
    '<text x="24" y="' + (y + 4) + '" text-anchor="middle">-</text>' +
    '<text x="176" y="' + (y + 4) + '" text-anchor="middle">+</text>';

  if (prev !== null) {
    out += '<circle class="ck-face-prev" cx="' + n2(CX + prev * TRACK_HALF) + '" cy="' + y + '" r="4.6"/>';
  }
  if (cur !== null) {
    const x = n2(CX + cur * TRACK_HALF);
    out += '<circle class="ck-face-cur" cx="' + x + '" cy="' + y + '" r="4"/>';
    if (needle === 'up') {
      out += '<path class="ck-face-nd-up" d="M ' + n2(x + 13) + ' ' + y + ' L ' + n2(x + 6) + ' ' +
             (y - 4.5) + ' L ' + n2(x + 6) + ' ' + (y + 4.5) + ' Z"/>';
    } else if (needle === 'down') {
      out += '<path class="ck-face-nd-down" d="M ' + n2(x - 13) + ' ' + y + ' L ' + n2(x - 6) + ' ' +
             (y - 4.5) + ' L ' + n2(x - 6) + ' ' + (y + 4.5) + ' Z"/>';
    } else if (needle === 'level') {
      out += '<path class="ck-face-nd-level" d="M ' + x + ' ' + (y - 10) + ' L ' + x + ' ' + (y + 10) + '"/>';
    }
  }
  return out;
}

/* ── reading the data ───────────────────────────────────────────────────────────────────── */

/**
 * Reduce the supplied rows to the two the card actually draws, and to a census of what was refused.
 *
 * Rows are sorted by `at` ascending with the caller's own order as the tiebreaker, so a log handed
 * over out of sequence still draws its true newest row and the reordering is reported rather than
 * hidden. Rows whose `at` cannot be read are dropped and counted — never coerced, because a
 * coerced timestamp is the one input that can make a stale card look fresh.
 *
 * @param data the card's `data`
 * @returns `{ newest, prev, counts, now }`, where `newest` and `prev` are raw rows or null
 *
 * @example digest({ rows: [{ at: 1, face: '\u{1F642}' }] }).counts.total;   // 1
 */
function digest(data) {
  const src = data && typeof data === 'object' ? data : {};
  const rowsIn = Array.isArray(src.rows) ? src.rows : [];
  const counts = { total: rowsIn.length, dropped: 0, reordered: 0 };

  const kept = [];
  for (const [i, r] of rowsIn.entries()) {
    if (!r || typeof r !== 'object') { counts.dropped++; continue; }
    const at = parseAt(r.at);
    if (at === null) { counts.dropped++; continue; }
    kept.push({ at, i, row: r });
  }

  for (let k = 1; k < kept.length; k++) if (kept[k].at < kept[k - 1].at) counts.reordered++;
  kept.sort((a, b) => a.at - b.at || a.i - b.i);

  const now = parseAt(src.now);
  return {
    newest: kept.length ? kept[kept.length - 1] : null,
    prev: kept.length > 1 ? kept[kept.length - 2] : null,
    counts,
    now,
  };
}

/* ── styles ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Every rule, scoped under `.ck-face`.
 *
 * Two colours of this card's own are defined on bare `:root` and overridden under
 * `:root[data-theme="light"]`, which the contract sanctions and which is the only place a colour
 * is written down. `prefers-color-scheme` is untouched: the desk is one document open in two
 * viewers that want opposite answers, and the OS gives both the same one. `prefers-reduced-motion`
 * *is* honoured, because motion here is garnish and carries nothing.
 *
 * The visibility rules fail closed. `.ck-face-live` is hidden unless `data-state` explicitly says
 * `live` or `fading`, so a card whose script never ran shows the quiet face and claims nothing.
 */
function styles() {
  return [
    '/* face — the only literal colours in this file, and the only place they are allowed. */',
    ':root {',
    '  --ck-face-up: var(--good);',
    '  --ck-face-down: oklch(0.70 0.16 25);',
    '}',
    ':root[data-theme="light"] {',
    '  --ck-face-down: oklch(0.50 0.19 25);',
    '}',
    '',
    '.ck-face { position: relative; }',
    '.ck-face .ck-face-wrap { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }',

    /* min-width:0 on the readout is what stops a 300-character signature widening the flex item
       past the card and giving the whole page a horizontal scrollbar. */
    '.ck-face .ck-face-stage { flex: 0 0 auto; width: 164px; max-width: 52%; height: auto;' +
      ' display: block; opacity: var(--ck-face-ink, 0.45); transition: opacity .5s linear; }',
    '.ck-face .ck-face-read { flex: 1 1 190px; min-width: 0; }',

    '.ck-face .ck-face-ring { fill: var(--well); stroke: var(--rule); stroke-width: 1.6; }',
    '.ck-face .ck-face-ring.is-dash { stroke: var(--ink-faint); stroke-dasharray: 7 6; }',
    '.ck-face .ck-face-ring.is-dot { stroke: var(--ink-faint); stroke-dasharray: 1.5 6; }',
    '.ck-face .ck-face-ink { fill: var(--ink); stroke: none; }',
    '.ck-face .ck-face-eyering { fill: none; stroke: var(--ink-faint); stroke-width: 1.6; }',
    '.ck-face .ck-face-line { fill: none; stroke: var(--ink); stroke-width: 4.6;' +
      ' stroke-linecap: round; stroke-linejoin: round; }',
    '.ck-face .ck-face-brow { fill: none; stroke: var(--ink); stroke-width: 4; stroke-linecap: round; }',
    '.ck-face .ck-face-thin { fill: none; stroke: var(--ink); stroke-width: 2.6; stroke-linecap: round; }',
    '.ck-face .ck-face-fill { fill: var(--well); stroke: var(--ink); stroke-width: 3.6;' +
      ' stroke-linejoin: round; }',
    '.ck-face .ck-face-bead { fill: var(--ink-faint); stroke: none; }',

    /* The confidence channel. Not a colour and not a feature: a second print that will not line up. */
    '.ck-face .ck-face-ghost { opacity: .34; }',

    '.ck-face .ck-face-track { fill: none; stroke: var(--rule); stroke-width: 1.4; }',
    '.ck-face .ck-face-tick { fill: none; stroke: var(--ink-faint); stroke-width: 1.2; }',
    '.ck-face .ck-face-prev { fill: none; stroke: var(--ink-faint); stroke-width: 2; }',
    '.ck-face .ck-face-cur { fill: var(--ink-dim); stroke: none; }',
    '.ck-face .ck-face-nd-up { fill: var(--ck-face-up); stroke: none; }',
    '.ck-face .ck-face-nd-down { fill: var(--ck-face-down); stroke: none; }',
    '.ck-face .ck-face-nd-level { fill: none; stroke: var(--ink-dim); stroke-width: 2; }',
    '.ck-face .ck-face-stage text { font-family: var(--mono); font-size: 10px; fill: var(--ink-faint); }',

    /* Fail closed: live is hidden until a real clock has been consulted. */
    '.ck-face .ck-face-live { display: none; }',
    '.ck-face .ck-face-quiet { display: inline; }',
    '.ck-face[data-state="live"] .ck-face-live,' +
      ' .ck-face[data-state="fading"] .ck-face-live { display: inline; }',
    '.ck-face[data-state="live"] .ck-face-quiet,' +
      ' .ck-face[data-state="fading"] .ck-face-quiet { display: none; }',
    '.ck-face[data-state="quiet"] .ck-face-axis { opacity: .6; }',

    '.ck-face .ck-face-sig { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 7px; }',
    '.ck-face .ck-face-glyph { font-size: 17px; line-height: 1.1; }',
    '.ck-face .ck-face-unc { font-size: 13px; color: var(--ink-faint); }',
    '.ck-face .ck-face-cc {' +
      ' font-family: var(--mono); font-size: 10px; color: var(--ink-dim);' +
      ' background: var(--pill); border: 1px solid var(--pill-edge); border-radius: 4px;' +
      ' padding: 1px 6px; }',
    /* The position is a property of the row rather than of the work, so it is not a pill: an
       identical chip beside the commit type would read as a second cc type. */
    '.ck-face .ck-face-pos { font-family: var(--mono); font-size: 10px; color: var(--ink-faint); }',
    '.ck-face .ck-face-text { margin-top: 7px; font: 400 13px/1.45 var(--ui); color: var(--ink);' +
      ' overflow-wrap: anywhere; }',
    '.ck-face .ck-face-need { margin-top: 6px; font: 400 12px/1.45 var(--mono);' +
      ' color: var(--ink-dim); overflow-wrap: anywhere; }',
    '.ck-face .ck-face-age { margin-top: 8px; font: 400 11px/1.4 var(--mono);' +
      ' color: var(--ink-faint); overflow-wrap: anywhere; }',

    '.ck-face .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',
    '.ck-face .ck-cap { overflow-wrap: anywhere; }',

    /* The idle. A slow drift on one group, run by the compositor, and nothing per frame in JS —
       the desk runs on a laptop and a face that warms it is a face that gets closed. */
    '@keyframes ck-face-drift {' +
      ' 0%, 100% { transform: translateY(0); }' +
      ' 50% { transform: translateY(var(--ck-face-amp, 2px)); } }',
    '@keyframes ck-face-turn { to { stroke-dashoffset: -52; } }',
    '.ck-face[data-idle="1"][data-state="live"] .ck-face-body {' +
      ' animation: ck-face-drift var(--ck-face-dur, 5s) ease-in-out infinite; }',
    '.ck-face[data-idle="1"][data-state="live"] .ck-face-ring.is-dash {' +
      ' animation: ck-face-turn 7s linear infinite; }',
    '@media (prefers-reduced-motion: reduce) { .ck-face * { animation: none !important; } }',
  ].join('\n');
}

/* ── the emitted script ─────────────────────────────────────────────────────────────────── */

/**
 * The browser script: classic ES5, because every card's script is concatenated into one inline
 * block and a single modern token there is a parse error that blanks the whole desk.
 *
 * It does exactly one job, and deliberately no more: decide which of the two pre-drawn faces is
 * showing, and how present it is. All geometry was settled in Node, so nothing here can invent an
 * expression even by accident — the browser has no access to the table.
 *
 * `CK.timer` rather than `CK.once` for the beat: `once` keys off the element, and a `<main>` swap
 * hands the builder a fresh one with an empty dataset, so the guard passes and a second interval
 * starts beside the first.
 *
 * @param id      the card's `data-card` value
 * @param payload the instant, the pinned clock, and the labels; no drawing parameters
 * @param defs    the settled settings, matching `meta.defaults`
 */
function script(id, payload, defs) {
  return '(function () {\n' +
"  'use strict';\n" +
'\n' +
'  var ID = ' + jsJson(id) + ';\n' +
'  var D = ' + jsJson(payload) + ';\n' +
'  var DEFAULTS = ' + jsJson(defs) + ';\n' +
'\n' +
'  /* The clock. A build may pin "now" for a reproducible render; when it does, the pin is the\n' +
'     ORIGIN and real elapsed time still runs on top of it. A pinned card therefore ages\n' +
'     honestly rather than freezing a claim of freshness, which is the failure that would make\n' +
'     the whole staleness rule decorative. */\n' +
'  var BOOT = Date.now();\n' +
'  function nowMs() { return D.now === null ? Date.now() : D.now + (Date.now() - BOOT); }\n' +
'\n' +
'  /** A finite number, or the fallback. Settings come out of localStorage, which is a text file\n' +
'      the viewer can edit, so every value read back is re-vetted. */\n' +
'  function num(v, fallback) {\n' +
'    var n = Number(v);\n' +
'    return isFinite(n) ? n : fallback;\n' +
'  }\n' +
'\n' +
'  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }\n' +
'\n' +
'  /** An age as words. Coarse on purpose: the reader wants the band, not the seconds. */\n' +
'  function ago(ms) {\n' +
'    var s = Math.floor(ms / 1000);\n' +
'    if (s < 45) return plural(s < 0 ? 0 : s, "second");\n' +
'    var m = Math.round(s / 60);\n' +
'    if (m < 60) return plural(m, "minute");\n' +
'    var h = Math.floor(m / 60), rm = m % 60;\n' +
'    if (h < 24) return plural(h, "hour") + (rm ? " " + rm + " min" : "");\n' +
'    var d = Math.floor(h / 24), rh = h % 24;\n' +
'    return plural(d, "day") + (rh ? " " + rh + " h" : "");\n' +
'  }\n' +
'\n' +
'  CK.build(ID, function (sec) {\n' +
'    var stage = sec.querySelector(".ck-face-stage");\n' +
'    var ageEl = sec.querySelector(".ck-face-age");\n' +
'    if (!stage) return;\n' +
'\n' +
'    var fresh = DEFAULTS.freshMins, stale = DEFAULTS.staleMins, stop = null;\n' +
'\n' +
'    /** What the age line says. Quiet is spelled out, because quiet is the state most likely to\n' +
'        be misread as a recorded calm. */\n' +
'    function phrase(state, age, future) {\n' +
'      if (!D.have) return "no signature rows supplied";\n' +
'      var tail = future ? " (this row is dated in the future)" : "";\n' +
'      if (state === "quiet") return "quiet: no signature for " + ago(age) + tail;\n' +
'      return "recorded " + ago(age) + " ago" + (state === "fading" ? ", going quiet" : "") + tail;\n' +
'    }\n' +
'\n' +
'    function label(state, age) {\n' +
'      if (!D.have) return "Affect face, quiet: no signature rows were supplied, so nothing is claimed.";\n' +
'      if (state === "quiet") {\n' +
'        return "Affect face, quiet: the last signature is " + ago(age) +\n' +
'               " old, so the face has stopped claiming a present state. This is not a recorded calm.";\n' +
'      }\n' +
'      var how = D.known ? ("drawn as " + D.look) :\n' +
'                          "resting, because the recorded face emoji is not in the table";\n' +
'      return "Affect face, " + how +\n' +
'             (D.unc ? ", printed out of register because the reading was marked uncertain" : "") +\n' +
'             ". Recorded " + ago(age) + " ago.";\n' +
'    }\n' +
'\n' +
'    /* Sets attributes and text only. Nothing here appends a node, so replaying the builder after\n' +
'       a swap repaints rather than stacking a second copy of anything. */\n' +
'    function tick() {\n' +
'      if (!document.contains(sec)) { if (stop) stop(); return; }\n' +
'      var state = "quiet", ink = 0.45, age = 0, future = false;\n' +
'\n' +
'      if (D.have && D.at !== null) {\n' +
'        age = nowMs() - D.at;\n' +
'        if (age < -60000) future = true;\n' +
'        if (age < 0) age = 0;\n' +
'        var f = fresh * 60000, s = stale * 60000;\n' +
'        if (age <= f) { state = "live"; ink = 1; }\n' +
'        else if (age < s) { state = "fading"; ink = 1 - 0.55 * ((age - f) / (s - f)); }\n' +
'      }\n' +
'\n' +
'      sec.setAttribute("data-state", state);\n' +
'      sec.style.setProperty("--ck-face-ink", String(Math.round(ink * 100) / 100));\n' +
'      if (ageEl) ageEl.textContent = phrase(state, age, future);\n' +
'      stage.setAttribute("aria-label", label(state, age));\n' +
'    }\n' +
'\n' +
'    /** Settings are re-vetted, then ordered: a quiet threshold at or below the fresh one would\n' +
'        divide by zero in the fade and would mean nothing anyway. */\n' +
'    function apply(cfg) {\n' +
'      fresh = Math.max(0, num(cfg.freshMins, DEFAULTS.freshMins));\n' +
'      stale = Math.max(fresh + 1, num(cfg.staleMins, DEFAULTS.staleMins));\n' +
'      sec.setAttribute("data-idle", cfg.idle ? "1" : "0");\n' +
'      tick();\n' +
'    }\n' +
'\n' +
'    CK.settings(sec, DEFAULTS, apply);\n' +
'\n' +
'    /* Fifteen seconds. The bands are minutes wide, so this is only about not being visibly late\n' +
'       to the moment a face goes quiet; it costs three attribute writes a minute. */\n' +
'    stop = CK.timer(ID + ":face", 15000, tick);\n' +
'  });\n' +
'})();\n';
}

/* ── the build-time guard ───────────────────────────────────────────────────────────────── */

/**
 * Blank comment and string bodies while preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose — one card was refused
 * because a comment said "the class is what CSS reads" — and a guard that cries wolf is a guard
 * that gets deleted. Regex literals are recognised too, because otherwise the scanner desyncs on
 * the quote in `replace(/'/g, x)` and blanks real code, turning a false positive into a far worse
 * false negative.
 *
 * A local copy of the same routine `check.mjs` uses, because that module runs its CLI on import
 * and cannot be borrowed from.
 *
 * @param src JavaScript source
 * @returns text of the same length with comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').includes('const');   // false
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
 * Refuse to emit a script the desk cannot survive.
 *
 * The deck's scripts are one inline block, so a backtick inside a comment closes a surrounding
 * template literal early and blanks every card on the page — which has happened five times. This
 * throws at build rather than shipping it.
 *
 * @param js the emitted script
 * @returns the same script, when it is safe
 * @throws {Error} naming the offending token and its offset
 *
 * @example guardScript('var a = 1;');   // 'var a = 1;'
 */
function guardScript(js) {
  const literal = [
    [String.fromCharCode(96), 'a backtick'],
    ['=>', 'an arrow function'],
    ['?.', 'optional chaining'],
  ];
  for (const [needle, what] of literal) {
    const at = js.indexOf(needle);
    if (at >= 0) throw new Error('face: emitted js contains ' + what + ' at offset ' + at);
  }
  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
      throw new Error('face: emitted js contains control character ' + c + ' at offset ' + i);
    }
  }
  const code = blankNonCode(js);
  for (const kw of ['const', 'let', 'class']) {
    const m = new RegExp('(^|[^\\w$.])' + kw + '[\\s({]').exec(code);
    if (m) throw new Error('face: emitted js declares ' + kw + ' at offset ' + m.index);
  }
  return js;
}

/* ── markup ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The signature line's own notation for a delta.
 *
 * The logger stores `up` / `down` / `steady`; the signature line writes arrows. Printing the
 * stored word in a slot flanked by two emoji reads as a stray label, so the line uses the
 * notation the format defines. A declared map, not a guess \u2014 the same three pairs `DELTAS`
 * accepts, read the other way.
 */
const DELTA_GLYPH = { up: '\u2b06\ufe0f', down: '\u2b07\ufe0f', steady: '\u27a1\ufe0f' };

/**
 * The signature line, reprinted beside the drawing.
 *
 * This is half of the audit surface and the cheaper half: the row is right there, so a reader can
 * check the drawn face against the emoji that produced it without opening anything. Every field is
 * escaped, and none of it reaches the drawing.
 *
 * @param row       the newest row, untrusted throughout
 * @param delta     the *normalised* delta, so an unreadable one prints nothing rather than junk
 * @param uncertain whether the reading was marked doubtful, however it was marked
 * @param faceRaw   the normalised face key
 */
function signatureLine(row, delta, uncertain, faceRaw) {
  const bits = [];
  if (delta && Object.hasOwn(DELTA_GLYPH, delta)) {
    bits.push('<span class="ck-face-glyph">' + DELTA_GLYPH[delta] + '</span>');
  }
  if (uncertain) bits.push('<span class="ck-face-unc" title="marked uncertain">\u2753</span>');
  bits.push('<span class="ck-face-glyph">' + esc(faceRaw || '\u2014') + '</span>');
  if (row.context) bits.push('<span class="ck-face-glyph">' + esc(row.context) + '</span>');
  if (row.cctype) bits.push('<span class="ck-face-cc">' + esc(row.cctype) + '</span>');
  if (row.position) bits.push('<span class="ck-face-pos">' + esc(row.position) + '</span>');
  return '<div class="ck-face-sig">' + bits.join('') + '</div>';
}

/**
 * The whole card.
 *
 * Ships with `data-state="quiet"`: the drawing that claims nothing is the one a card without a
 * working script is left holding.
 */
function markup(id, title, o, seen, cfg) {
  const f = (name) => esc(id) + '-' + name;

  /* From the table and nowhere else: a tense face idles tight and quick, a calm one slow and
     wide. Bounded so a bad arousal can never produce a number the browser will not take. */
  const amp = n2(1.2 + (1 - Math.min(1, Math.max(0, o.arousal))) * 2.2);
  const dur = n2(2.6 + (1 - Math.min(1, Math.max(0, o.arousal))) * 4.4);

  const quietFace = { ...QUIET, ring: 'dot', uncertain: 0, bead: 0 };

  const svg =
    '<svg class="ck-face-stage" viewBox="' + BOX + '" role="img"' +
    ' data-look="' + esc(seen.lookKey) + '"' +
    ' aria-label="' + esc(seen.staticLabel) + '">' +
      '<g class="ck-face-quiet">' + faceGroup(quietFace) + '</g>' +
      '<g class="ck-face-live"><g class="ck-face-body">' + faceGroup(o) + '</g></g>' +
      '<g class="ck-face-axis">' + axisGroup(seen.valence, seen.prevValence, o.needle) + '</g>' +
    '</svg>';

  const read =
    '<div class="ck-face-read">' +
      seen.sig +
      (seen.text ? '<div class="ck-face-text">' + esc(seen.text) + '</div>' : '') +
      (seen.need ? '<div class="ck-face-need">need: ' + esc(seen.need) + '</div>' : '') +
      '<div class="ck-face-age">' + esc(seen.staticAge) + '</div>' +
    '</div>';

  return '<section data-card="' + esc(id) + '" class="ck-face"' +
    ' data-state="quiet" data-idle="' + (cfg.idle ? '1' : '0') + '"' +
    ' style="--ck-face-amp: ' + amp + 'px; --ck-face-dur: ' + dur + 's">' +
    '<h2>' + esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="face settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('fresh') + '">fresh (min)</label>' +
      '<input id="' + f('fresh') + '" name="freshMins" type="number" min="0" max="1440" step="1"' +
        ' value="' + esc(cfg.freshMins) + '">' +
      '<label for="' + f('stale') + '">quiet after (min)</label>' +
      '<input id="' + f('stale') + '" name="staleMins" type="number" min="1" max="10080" step="1"' +
        ' value="' + esc(cfg.staleMins) + '">' +
      '<label for="' + f('idle') + '">idle motion</label>' +
      '<input id="' + f('idle') + '" name="idle" type="checkbox"' + (cfg.idle ? ' checked' : '') + '>' +
      '<p class="ck-set-foot">Quiet is not calm: past this age the face stops claiming a present state.</p>' +
    '</div>' +

    '<div class="ck-face-wrap">' + svg + read + '</div>' +
    '<div class="ck-cap">' + seen.caption + '</div>' +
  '</section>';
}

/* ── build ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Build one face card: the newest recorded affect signature, drawn.
 *
 * @param id    the card's identity; becomes `data-card` and the settings storage key, so it must
 *              be a plain `[A-Za-z0-9_-]` name
 * @param title the card's heading, shown verbatim
 * @param data  `{ rows, now }` — rows out of the affect log, newest last (or in any order; they
 *              are sorted). `now` pins the build clock in epoch milliseconds for a reproducible
 *              render, and real elapsed time still runs on top of it
 * @param ord   the card's position on the desk, low first; defaults to 10
 * @returns `{ json, html, css, js }` — the bodies of `card.json`, `card.html`, `card.css` and
 *          `card.js`, all four as strings
 * @throws {TypeError} when `id` is not a plain name
 * @throws {Error} when the emitted script contains a token that would blank the deck
 *
 * @example
 * const { html } = build({ id: 'affect', title: 'Right now', ord: 10, data: { rows: [
 *   { at: '2026-08-29T17:02:00Z', delta: 'up', uncertain: false, face: '\u{1F642}',
 *     context: '\u{1F9ED}', cctype: 'feat', text: 'flow; clear plan' }] } });
 *
 * @example
 * // no rows at all: a quiet face and a caption that says so, rather than an empty box
 * build({ id: 'affect', title: 'Right now', data: {} });
 *
 * @see LOOKS  the mapping table, and the only place expression is decided
 * @see look   the pure function from (face, delta, uncertain) to drawing parameters
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'face' : id);
  if (!/^[\w-]+$/.test(cardId)) {
    throw new TypeError('face: id must be a plain [A-Za-z0-9_-] name, got ' + JSON.stringify(id));
  }
  const heading = String(title == null ? 'Affect' : title);
  const cfg = { ...defaults };

  const { newest, prev, counts, now } = digest(data);

  const row = newest ? newest.row : {};
  const faceIn = normFace(row.face);
  const deltaIn = normDelta(row.delta);
  const uncertain = !!row.uncertain || faceIn.flagged;

  const o = newest ? look(faceIn.key, deltaIn.delta, uncertain) : look('', null, false);

  /* The previous row contributes exactly one number: where its hollow mark sits. An unreadable
     previous face gets no mark rather than one at zero, and that falls out of the table instead
     of being defended here — {@link REST} declares `valence: null` precisely so it does. This was
     a conditional until a mutation test showed the condition could never be false; a guard the
     suite cannot make fail is a guard that is not being checked, so it became an invariant on the
     table that the suite asserts directly. */
  const prevValence = prev ? look(normFace(prev.row.face).key, null, false).valence : null;

  const total = counts.total;
  const notes = [];
  if (!newest) {
    notes.push(total ? 'every supplied row was refused' : 'no rows were supplied');
  }
  if (counts.dropped) {
    notes.push(counts.dropped + ' of ' + total + ' rows refused for an unreadable timestamp');
  }
  if (counts.reordered) notes.push('rows arrived out of order and were sorted by time');
  if (newest && !o.known) {
    notes.push('the recorded face ' + (faceIn.key ? JSON.stringify(faceIn.key) : '(missing)') +
               ' is not in the table, so the drawing rests');
  }
  if (newest && !deltaIn.known) {
    notes.push('the recorded delta ' + JSON.stringify(String(row.delta)) +
               ' is not one this card reads, so no arrowhead is drawn');
  }
  if (newest && deltaIn.known && deltaIn.delta === null) {
    notes.push('no delta was recorded, so none is drawn');
  }
  if (newest && deltaIn.delta !== null && !prev) {
    notes.push('a delta was recorded but no previous row was supplied, so its comparison point is not shown');
  }
  if (now !== null) notes.push('the clock was pinned at build time and ages from there');

  const seen = {
    lookKey: lookKey(o),
    valence: newest ? o.valence : null,
    prevValence,
    text: newest ? String(row.text == null ? '' : row.text) : '',
    need: newest ? String(row.need == null ? '' : row.need) : '',
    sig: newest ? signatureLine(row, deltaIn.delta, uncertain, faceIn.key) : '',
    staticAge: newest
      ? 'quiet until the clock is checked'
      : (total ? 'no usable signature rows' : 'no signature rows supplied'),
    staticLabel: newest
      ? 'Affect face, quiet until a clock has been consulted.'
      : 'Affect face, quiet: no signature rows were supplied, so nothing is claimed.',
    caption: '',
  };

  seen.caption =
    '<b>' + esc(newest ? (faceIn.key || '\u2014') : '\u2014') + '</b> ' +
    (newest ? 'the newest recorded signature, drawn from a table as <i>' + esc(o.name) + '</i>. '
            : 'nothing recorded. ') +
    'expression comes only from <i>face</i>, <i>delta</i> and <i>uncertain</i> \u2014 never from the ' +
    'text, so two rows carrying those same three values draw the same picture whatever they say; the ' +
    'parameters are on the drawing as <i>data-look</i> and the row itself is printed beside it. ' +
    '<i>uncertain</i> is given no expression, because every facial candidate reads as some other ' +
    'emotion instead of as doubt: it prints the face twice, out of register, inside a broken ring. ' +
    'the bar underneath is valence \u2014 hollow is the previous row, filled is this one, and the ' +
    'arrowhead is the delta <i>as recorded</i>, never inferred from the gap. the drawing fades after ' +
    esc(cfg.freshMins) + ' minutes and goes quiet after ' + esc(cfg.staleMins) + '. ' +
    '<span class="ck-aside">quiet means no reading, not calm: it draws dashes, where a recorded ' +
    'neutral keeps round eyes and a full-width mouth and an unrecognised emoji rests with dots and ' +
    'no mouth at all.</span>' +
    (notes.length ? ' <span class="ck-aside">' + esc(notes.join('; ')) + '.</span>' : '');

  const payload = {
    at: newest ? newest.at : null,
    now,
    have: newest ? 1 : 0,
    look: o.name,
    known: o.known ? 1 : 0,
    unc: o.uncertain,
  };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 10,
      type: meta.name,
      category: meta.category,
      settings: { ...cfg },
      rows: total,
      refused: counts.dropped,
    },
    html: markup(cardId, heading, o, seen, cfg),
    css: styles(),
    js: guardScript(script(cardId, payload, cfg)),
  };
}

export default { meta, build, look, lookKey, LOOKS };
