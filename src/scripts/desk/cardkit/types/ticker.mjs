/**
 * @file cardkit card type: `ticker` — a dense strip of symbols carrying last price, absolute and
 * percent change, and a day sparkline drawn against the previous close.
 *
 * Why a card type: three hand-written watchlist cards each invented their own answer to the same
 * two questions — what does a sparkline measure against, and what does the card show when the
 * previous close is zero. Both answers were different every time and one of them was `Infinity`.
 * This settles them once: the sparkline baselines on `prevClose`, and an undefined percent is an
 * em dash rather than a number that is not one.
 *
 * Everything the browser needs to know about the data is already in the markup, escaped, at build
 * time. The emitted script only flips attributes and reorders rows that already exist — it never
 * writes markup from data — so the injection surface of this card is exactly the build step.
 *
 * The emitted script is ES5-shaped on purpose: `var`, function expressions, no template literals,
 * no arrows. It is concatenated with every other card's script into one inline block, so one
 * modern-syntax token takes the entire desk down rather than this one card.
 *
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object; both are honoured here
 * @see ../kit.js      — `CK.scale`, `CK.esc`, `CK.settings`, `CK.timer`, `CK.card`, `CK.build`
 * @see ../kit.css     — `.ck-scroll`, `.ck-gear`, `.ck-set`, `.ck-cap`, the `--ck-s*` tokens
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so build-time drawing and browser-time drawing
 * use one implementation rather than two that drift.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level defines only functions and one array, and nothing reaches for
 * `document` until a DOM-bound function is called — none of which this file calls — so a bare
 * context carrying an empty `window` is enough to run it.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().scale([0, 10], [0, 100])(5);   // 50
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/ticker: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/ticker: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting the ticker understands, with the value that stands when nothing is stored.
 *
 * The four column switches are separate booleans rather than one `columns` list because
 * `CK.settings` binds one control to one key by `name`, and a list would need a bespoke reader on
 * both sides of `localStorage` — where the stored value is a text file the viewer can edit, and
 * therefore has to be re-vetted anyway. Four booleans are four checkboxes and no parser.
 *
 * @example DEFAULTS.sort;   // 'given'
 */
const DEFAULTS = {
  showLast:    true,
  showChange:  true,
  showPercent: true,
  showSpark:   true,
  sort:        'given',
  compact:     false,
};

/** The orders a viewer may ask for. Anything else falls back to `given` rather than blanking. */
const SORTS = ['given', 'symbol', 'percent'];

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `shape` is a string and `defaults` is an object, per `CONTRACT.md`. The two are different kinds
 * of thing on purpose: `shape` is read by a person choosing a type, `defaults` is read by a
 * machine checking a settings panel, and the drift that produced the contract was exactly the
 * habit of writing `shape` as the second of those.
 *
 * @example meta.name;   // 'ticker'
 */
export const meta = {
  name: 'ticker',
  summary: 'A dense strip of symbols: last price, change, percent, and a day sparkline against the previous close.',
  shape: '{ rows: [{ symbol, name, last, prevClose, series: [n], currency }], asOf } — ' +
         'series is the day\'s prices in time order and may be empty; prevClose is the reference ' +
         'the sparkline baselines on and the denominator of the percent change',
  defaults: { ...DEFAULTS },
};

/**
 * Every setting this card understands, exported beside `meta.defaults` so a validator can check
 * the emitted panel's field names against it without building a card first.
 *
 * @example defaults.compact;   // false
 */
export const defaults = { ...DEFAULTS };

/** The em dash, as markup, for every quantity that is genuinely undefined rather than zero. */
const MDASH = '&mdash;';

/** Two decimal places at most, so emitted path data stays short and diffs stay readable. */
function n2(v) { return Math.round(v * 100) / 100; }

/**
 * A JSON literal safe to paste into a classic `<script>` body.
 *
 * `JSON.stringify` alone is not enough: a value containing `</script` closes the element early
 * and the rest of the card renders as text. Escaping the angle brackets — and the two line
 * separators that are newlines to a JS parser but not to JSON — closes both holes.
 *
 * @example jsJson({ a: '</script>' });   // '{"a":"\\u003c/script\\u003e"}'
 */
function jsJson(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A value's magnitude as an exact integer count of minor units at `dp` decimal places.
 *
 * This is the whole rounding decision, and it is deliberate rather than a `toFixed` call.
 *
 * `toFixed` is not used for money anywhere in this file for two reasons. The first is that it
 * rounds the binary double, not the decimal the reader typed: `(1.005).toFixed(2)` is `'1.00'`,
 * because 1.005 is stored a hair below one and a half hundredths, and a cent goes missing with no
 * warning. The second is that a string is a dead end — once a row is `'1.01'` the totals row can
 * only add unrounded floats and disagree with the column above it, which is the single most
 * embarrassing bug a finance card can ship.
 *
 * So every displayed quantity becomes an integer here, once, and every sum after that is integer
 * arithmetic on those same integers. The totals row cannot fail to add up because it is literally
 * the sum of what the rows display.
 *
 * The epsilon undoes exactly the representation error above: it is scaled to the magnitude of the
 * value, so it nudges a number that is a hair under a half up to it without ever promoting one
 * that genuinely sits below. Rounding is half away from zero, which is what a reader expects of a
 * price and what every accounting convention in use here does.
 *
 * @param value any number; non-finite input yields null so the caller can print an em dash
 * @param dp    decimal places to keep; 2 for cents, 4 for sub-dollar prices, 0 for whole units
 * @returns an integer count of minor units, or null when the value cannot be held exactly
 *
 * @example minor(1.005, 2);    // 101   — toFixed would say 100
 * @example minor(-2.675, 2);   // -268
 * @example minor(Infinity, 2); // null
 */
function minor(value, dp) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) * Math.pow(10, dp);

  /* Past 2^53 the integers stop being exact and every promise this function makes stops being
     true. A book that large is beyond what a cent-exact card can honestly render, and an em dash
     is a better answer than a number that is quietly wrong in its low digits. */
  if (!(scaled < Number.MAX_SAFE_INTEGER)) return null;

  const eps = Math.max(Number.EPSILON * scaled * 4, Number.EPSILON);
  return sign * Math.floor(scaled + 0.5 + eps);
}

/** Thousands separators, inserted into a run of digits from the right. */
function groupDigits(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * An integer count of minor units, rendered as the decimal a reader expects.
 *
 * Purely string work over an integer, so nothing here can reintroduce the float error that
 * {@link minor} just removed. Zero never takes a `+`: an arrow claiming a rise beside `+0.00`
 * reads as a bug even when the underlying move was a fraction of a cent.
 *
 * @param units integer minor units, or null for an undefined quantity
 * @param dp    the decimal places those units are counted in
 * @param sign  true to mark a positive value with a leading `+`
 * @returns display text, or the em-dash entity when `units` is null
 *
 * @example minorText(101, 2, true);    // '+1.01'
 * @example minorText(-4200, 2, false); // '-42.00'
 * @example minorText(null, 2, false);  // '&mdash;'
 */
function minorText(units, dp, sign) {
  if (units == null || !Number.isFinite(units)) return MDASH;
  const neg = units < 0;
  let digits = String(Math.abs(units));
  if (dp > 0) {
    while (digits.length <= dp) digits = '0' + digits;
    digits = groupDigits(digits.slice(0, digits.length - dp)) + '.' + digits.slice(digits.length - dp);
  } else {
    digits = groupDigits(digits);
  }
  return (neg ? '-' : (sign && units > 0 ? '+' : '')) + digits;
}

/**
 * How many decimals a price of this size deserves.
 *
 * Two for anything a dollar and up, four below it: a penny stock quoted to two places is a chart
 * of rounding, and a four-place index level is noise. Chosen per row from whichever reference the
 * row actually has, so a row missing `last` still picks a sane width from `prevClose`.
 *
 * @example dpFor(412.5);   // 2
 * @example dpFor(0.0431);  // 4
 */
function dpFor(...candidates) {
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.abs(v) >= 1 ? 2 : 4;
  }
  return 2;
}

/** A finite number, or null. Used everywhere a caller's number is read for the first time. */
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/**
 * One row's model: everything the markup needs, all arithmetic already done.
 *
 * The percent is computed against the magnitude of `prevClose` rather than its signed value, so
 * the sign of the percent always matches the sign of the change. That is not pedantry — a
 * negative previous close is a real thing that has happened to a real contract, and dividing by
 * it silently reports a rise as a fall.
 *
 * Direction is taken from the *rounded* change, so the arrow can never contradict the number
 * printed beside it. A move that rounds to nothing draws flat and prints `0.00`.
 *
 * @param raw a caller's row; every field is untrusted and every number may be absent
 * @param ix  the row's position in the given order, kept so `given` remains a real sort
 *
 * @example model({ symbol: 'X', last: 10, prevClose: 8 }, 0).pctMinor;   // 2500  (i.e. +25.00%)
 * @example model({ symbol: 'X', last: 10, prevClose: 0 }, 0).pctMinor;   // null  (em dash)
 */
function model(raw, ix) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const last = num(r.last);
  const prev = num(r.prevClose);
  const dp = dpFor(last, prev);

  const lastMinor = minor(last, dp);
  const prevMinor = minor(prev, dp);

  /* The change is the difference of the two DISPLAYED prices, not of the raw floats, so a reader
     can subtract the two columns in their head and get the third. */
  const changeMinor = lastMinor == null || prevMinor == null ? null : lastMinor - prevMinor;

  const pctMinor = changeMinor == null || prevMinor === 0
    ? null
    : minor(changeMinor / Math.abs(prevMinor) * 100, 2);

  const dir = changeMinor == null ? 'na' : changeMinor > 0 ? 'up' : changeMinor < 0 ? 'dn' : 'flat';

  /* Non-finite samples are dropped rather than plotted as gaps: a polyline cannot express a hole,
     and a straight segment across one is a lie about the shape. Order is preserved. */
  const series = Array.isArray(r.series) ? r.series.map(num).filter((v) => v !== null) : [];

  const symbol = String(r.symbol == null ? '' : r.symbol);

  return {
    ix,
    symbol,
    sortKey: symbol.toUpperCase(),
    name: r.name == null ? '' : String(r.name),
    currency: r.currency == null ? '' : String(r.currency).trim(),
    dp, last, prev, lastMinor, prevMinor, changeMinor, pctMinor, dir, series,
  };
}

/* Sparkline geometry. Small enough to read as a glyph in a dense row, wide enough that a day of
   minute bars is a shape rather than a smudge. The padding keeps a stroke at the domain's extreme
   inside the box instead of clipped in half by the viewBox edge. */
const SPARK_W = 96;
const SPARK_H = 24;
const SPARK_PAD = 3;

/**
 * One row's sparkline: a hand-drawn polyline over a baseline at the previous close.
 *
 * The baseline is the point of the whole drawing. A sparkline scaled to its own minimum tells you
 * where the day's low was, which nobody asked; scaled to include `prevClose` and drawn with that
 * reference visible, it tells you whether the day is up or down, which is the only question a
 * ticker row exists to answer.
 *
 * @param row a model from {@link model}
 * @returns SVG markup, or the em-dash entity when there is nothing at all to draw
 *
 * @example spark(model({ symbol: 'X', prevClose: 5, series: [] }, 0)).indexOf('ck-tk-base') > 0;  // true
 */
function spark(row) {
  const pts = row.series;
  const domain = pts.slice();
  if (row.prev !== null) domain.push(row.prev);

  /* No samples and no reference is not an empty chart, it is the absence of one. Drawing an empty
     box would claim a flat day. */
  if (domain.length === 0) return MDASH;

  const lo = Math.min(...domain);
  const hi = Math.max(...domain);

  /* CK.scale maps a zero-width domain to the midpoint of the range rather than dividing by zero,
     which is exactly right here: a day that never moved is a flat line through the middle. */
  const y = CK.scale([lo, hi], [SPARK_H - SPARK_PAD, SPARK_PAD]);
  const x = CK.scale([0, Math.max(0, pts.length - 1)], [1, SPARK_W - 1]);

  const parts = [];

  if (row.prev !== null) {
    const by = n2(y(row.prev));
    parts.push('<line class="ck-tk-base" x1="0" y1="' + by + '" x2="' + SPARK_W + '" y2="' + by + '"/>');
  }

  if (pts.length >= 2) {
    const coords = pts.map((v, i) => n2(x(i)) + ',' + n2(y(v))).join(' ');
    parts.push('<polyline class="ck-tk-line" points="' + coords + '"/>');
    parts.push('<circle class="ck-tk-head" cx="' + n2(x(pts.length - 1)) + '" cy="' + n2(y(pts[pts.length - 1])) + '" r="1.7"/>');
  } else if (pts.length === 1) {
    /* A one-point polyline draws nothing at all — SVG needs two points to make a segment — so the
       single sample is drawn as the mark it is. CK.scale has already centred it horizontally. */
    parts.push('<circle class="ck-tk-head" cx="' + n2(x(0)) + '" cy="' + n2(y(pts[0])) + '" r="1.7"/>');
  }

  return '<svg class="ck-tk-spark" viewBox="0 0 ' + SPARK_W + ' ' + SPARK_H + '" ' +
         'aria-hidden="true">' + parts.join('') + '</svg>';
}

/**
 * The direction glyph, drawn rather than typed.
 *
 * `CK.svg` is not used here and it is worth saying why: it hard-codes `fill="none"` for the
 * stroked idiom the rest of the desk shares, and a direction arrow at ten pixels reads as a solid
 * wedge and not as an outline. An emoji triangle would be a font lottery at this size.
 *
 * @param dir one of `up`, `dn`, `flat`, `na`
 *
 * @example arrow('up').indexOf('<svg') === 0;   // true
 */
function arrow(dir) {
  const open = '<svg class="ck-tk-arrow" viewBox="0 0 12 12" aria-hidden="true">';
  if (dir === 'up') return open + '<path fill="currentColor" d="M6 1.6 11 9.4H1Z"/></svg>';
  if (dir === 'dn') return open + '<path fill="currentColor" d="M6 10.4 1 2.6h10Z"/></svg>';
  if (dir === 'flat') {
    return open + '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M2 6h8"/></svg>';
  }
  return open + '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M3 3 9 9M9 3 3 9"/></svg>';
}

/** A screen-reader word for the direction, since the glyph beside it is `aria-hidden`. */
function dirWord(dir) {
  return dir === 'up' ? 'up' : dir === 'dn' ? 'down' : dir === 'flat' ? 'unchanged' : 'unknown';
}

/**
 * Fold a caller's seed onto the defaults, rejecting anything the card cannot honour.
 *
 * Coercive rather than strict: a card descriptor may be hand-edited, and a typo in `sort` should
 * give a working ticker in the default order rather than an empty box.
 *
 * @param seed partial settings; missing and null-valued keys keep their default
 *
 * @example settle({ sort: 'nope', compact: 1 }).sort;   // 'given'
 */
function settle(seed) {
  const out = { ...DEFAULTS };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.showLast = !!out.showLast;
  out.showChange = !!out.showChange;
  out.showPercent = !!out.showPercent;
  out.showSpark = !!out.showSpark;
  out.compact = !!out.compact;
  if (!SORTS.includes(out.sort)) out.sort = DEFAULTS.sort;
  return out;
}

/** `<option>` markup with the settled value pre-selected, so a static render is already correct. */
function options(pairs, chosen) {
  return pairs.map(([v, label]) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>'
  ).join('');
}

/** `on` / `off`, the two values every one of this card's toggle attributes takes. */
function flag(v) { return v ? 'on' : 'off'; }

/**
 * An instant as a fixed UTC label, for the render that happens before any script does.
 *
 * UTC and not the builder's zone: a card is built on one machine and read on another, and a
 * timestamp silently in somebody else's local time is worse than one that names its zone.
 *
 * @example utcLabel(Date.parse('2026-08-29T20:00:00Z'));   // '2026-08-29 20:00 UTC'
 */
function utcLabel(ms) {
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16) + ' UTC';
}

/**
 * One `<tr>`, fully escaped, with the sort keys the browser will need hung off it as attributes.
 *
 * The percent carried in `data-pct` is the *displayed* percent, not the raw one. Sorting on the
 * number the reader can see means the order can never look wrong to someone checking it against
 * the column — two rows that print the same percent stay in their given order rather than
 * swapping on a difference nobody can see.
 *
 * @param row      a model from {@link model}
 * @param showCur  true when the strip mixes currencies and each row must name its own
 */
function rowHtml(row, showCur) {
  const cur = showCur && row.currency
    ? ' <span class="ck-tk-cur">' + CK.esc(row.currency) + '</span>'
    : '';

  const name = row.name
    ? '<span class="ck-tk-name">' + CK.esc(row.name) + '</span>'
    : '';

  return '<tr class="ck-tk-row ck-' + row.dir + '" data-ix="' + row.ix + '"' +
           ' data-sym="' + CK.esc(row.sortKey) + '"' +
           (row.pctMinor == null ? '' : ' data-pct="' + row.pctMinor + '"') + '>' +
         '<td class="ck-tk-c-sym"><span class="ck-tk-sym">' + CK.esc(row.symbol) + '</span>' + name + '</td>' +
         '<td class="ck-tk-c-dir">' + arrow(row.dir) +
           '<span class="ck-tk-vh">' + dirWord(row.dir) + '</span></td>' +
         '<td class="ck-tk-c-last">' + minorText(row.lastMinor, row.dp, false) + cur + '</td>' +
         '<td class="ck-tk-c-chg">' + minorText(row.changeMinor, row.dp, true) + '</td>' +
         '<td class="ck-tk-c-pct">' + (row.pctMinor == null ? MDASH : minorText(row.pctMinor, 2, true) + '%') + '</td>' +
         '<td class="ck-tk-c-spark">' + spark(row) + '</td>' +
         '</tr>';
}

/**
 * The card's markup: heading, gear, settings panel, the strip, and a caption.
 *
 * The gear button is emitted empty on purpose — `CK.settings` fills it with the kit's drawn gear,
 * and a glyph typed here would be a second source of truth for a shape the kit already owns.
 */
function markup(id, title, cfg, rows, currencies, asOf) {
  const f = (name) => CK.esc(id) + '-' + name;

  const showCur = currencies.length > 1;

  const head =
    '<thead><tr>' +
    '<th class="ck-tk-c-sym" scope="col">symbol</th>' +
    '<th class="ck-tk-c-dir" scope="col"><span class="ck-tk-vh">direction</span></th>' +
    '<th class="ck-tk-c-last" scope="col">last</th>' +
    '<th class="ck-tk-c-chg" scope="col">chg</th>' +
    '<th class="ck-tk-c-pct" scope="col">%</th>' +
    '<th class="ck-tk-c-spark" scope="col">day</th>' +
    '</tr></thead>';

  const strip = rows.length === 0
    ? '<div class="ck-tk-void">no symbols on this strip</div>'
    : '<div class="ck-scroll"><table class="ck-tk">' + head +
      '<tbody class="ck-tk-body">' + rows.map((r) => rowHtml(r, showCur)).join('') + '</tbody>' +
      '</table></div>';

  const curNote = currencies.length === 0 ? ''
    : currencies.length === 1 ? ' <i>' + CK.esc(currencies[0]) + '</i>'
    : ' <i>mixed currencies, marked per row</i>';

  /* The static text is the absolute instant, not a relative one. A card rendered into a file and
     read an hour later would otherwise claim "just now" forever; the script replaces this with the
     relative form the moment it runs, and a render with no script still tells the truth. */
  const asOfNote = asOf === null ? ''
    : ' <span class="ck-aside">as of <time class="ck-tk-ago" datetime="' +
      CK.esc(new Date(asOf).toISOString()) + '">' + CK.esc(utcLabel(asOf)) + '</time></span>';

  const caption =
    '<div class="ck-cap"><b>' + rows.length + (rows.length === 1 ? ' symbol' : ' symbols') + '</b>' +
    curNote + asOfNote + '</div>';

  const check = (key, label) =>
    '<label for="' + f(key) + '">' + label + '</label>' +
    '<input id="' + f(key) + '" name="' + key + '" type="checkbox"' + (cfg[key] ? ' checked' : '') + '>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-ticker"' +
    ' data-sort="' + CK.esc(cfg.sort) + '"' +
    ' data-compact="' + flag(cfg.compact) + '"' +
    ' data-last="' + flag(cfg.showLast) + '"' +
    ' data-change="' + flag(cfg.showChange) + '"' +
    ' data-percent="' + flag(cfg.showPercent) + '"' +
    ' data-spark="' + flag(cfg.showSpark) + '">' +

    '<h2>' + CK.esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="ticker settings"></button>' +

    '<div class="ck-set" hidden>' +
      check('showLast', 'last') +
      check('showChange', 'change') +
      check('showPercent', 'percent') +
      check('showSpark', 'sparkline') +
      '<label for="' + f('sort') + '">order</label>' +
      '<select id="' + f('sort') + '" name="sort">' +
        options([['given', 'as given'], ['symbol', 'by symbol'], ['percent', 'by percent']], cfg.sort) +
      '</select>' +
      '<label for="' + f('compact') + '">compact</label>' +
      '<input id="' + f('compact') + '" name="compact" type="checkbox"' + (cfg.compact ? ' checked' : '') + '>' +
      '<p class="ck-set-foot">Percent order puts the biggest gainer first; rows with no previous close sort last.</p>' +
    '</div>' +

    strip + caption +
  '</section>';
}

/**
 * Every rule scoped under `.ck-ticker`.
 *
 * There is not one literal colour in here. The desk is a single document open in a browser and an
 * editor that want opposite themes, so a hex would be wrong in exactly one of them, and
 * `prefers-color-scheme` is untouched because the OS cannot give two viewers different answers.
 *
 * The three direction aliases are references, not colours: they point at series tokens that
 * already carry a value for each theme, so nothing here needs a light-mode override.
 */
function styles() {
  const rules = [
    '.ck-ticker {',
    '  position: relative;',
    '  --ck-up: var(--ck-s4);',
    '  --ck-dn: var(--ck-s1);',
    '  --ck-na: var(--ink-faint);',
    '}',

    /* A strip is a table because a strip is columns that have to line up; tabular figures are what
       make the digits line up inside those columns rather than merely near them. */
    '.ck-ticker .ck-tk {',
    '  width: 100%; border-collapse: collapse; table-layout: auto;',
    '  font-family: var(--mono); font-size: 11.5px; color: var(--ink);',
    '  font-variant-numeric: tabular-nums;',
    '}',
    '.ck-ticker .ck-tk th {',
    '  font: 700 9px/1 var(--ui); letter-spacing: .08em; text-transform: uppercase;',
    '  color: var(--ink-faint); text-align: right; white-space: nowrap; padding: 0 0 5px;',
    '}',
    '.ck-ticker .ck-tk td {',
    '  padding: 5px 0; border-top: 1px solid var(--hairline);',
    '  text-align: right; white-space: nowrap; vertical-align: middle;',
    '}',
    '.ck-ticker .ck-tk th + th, .ck-ticker .ck-tk td + td { padding-left: 12px; }',
    '.ck-ticker .ck-tk tbody tr:first-child td { border-top-color: var(--rule); }',

    '.ck-ticker .ck-tk-c-sym { text-align: left; }',
    '.ck-ticker .ck-tk-sym { color: var(--ink); font-weight: 700; letter-spacing: .02em; }',
    '.ck-ticker .ck-tk-name {',
    '  display: block; font-family: var(--ui); font-size: 10px; color: var(--ink-faint);',
    '  margin-top: 1px; max-width: 22ch; overflow: hidden; text-overflow: ellipsis;',
    '}',
    '.ck-ticker .ck-tk-cur { color: var(--ink-faint); font-size: 9.5px; margin-left: 3px; }',

    /* The arrow column is never hidden. Direction has to survive every combination of the column
       switches, and colour on its own is not an encoding — it is a hint that a third of readers
       cannot use and that no reader can use in a screenshot printed in grey. */
    '.ck-ticker .ck-tk-c-dir { width: 12px; padding-left: 8px; }',
    '.ck-ticker .ck-tk-arrow { width: 9px; height: 9px; display: inline-block; vertical-align: middle; }',

    '.ck-ticker .ck-tk-spark { display: block; width: 96px; height: 24px; }',
    '.ck-ticker .ck-tk-line { fill: none; stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }',
    '.ck-ticker .ck-tk-base { stroke: var(--ck-grid); stroke-width: 1; stroke-dasharray: 2 2; }',
    '.ck-ticker .ck-tk-c-spark { width: 96px; }',

    /* Direction, three times over: the glyph carries it without colour, the sign carries it in
       text, and the token carries it for everyone reading at a glance. */
    '.ck-ticker tr.ck-up .ck-tk-c-dir, .ck-ticker tr.ck-up .ck-tk-c-chg, .ck-ticker tr.ck-up .ck-tk-c-pct { color: var(--ck-up); }',
    '.ck-ticker tr.ck-dn .ck-tk-c-dir, .ck-ticker tr.ck-dn .ck-tk-c-chg, .ck-ticker tr.ck-dn .ck-tk-c-pct { color: var(--ck-dn); }',
    '.ck-ticker tr.ck-flat .ck-tk-c-dir, .ck-ticker tr.ck-flat .ck-tk-c-chg, .ck-ticker tr.ck-flat .ck-tk-c-pct { color: var(--ink-dim); }',
    '.ck-ticker tr.ck-na .ck-tk-c-dir, .ck-ticker tr.ck-na .ck-tk-c-chg, .ck-ticker tr.ck-na .ck-tk-c-pct { color: var(--ck-na); }',
    /* Stroke and fill are set on separate selectors rather than one shared rule. A rule naming
       both the polyline and the head would give the polyline a fill, and a filled sparkline is a
       shaded area chart — and it would win on specificity over any later `fill: none`, which is
       how that mistake survives a review. */
    '.ck-ticker tr.ck-up .ck-tk-line { stroke: var(--ck-up); }',
    '.ck-ticker tr.ck-dn .ck-tk-line { stroke: var(--ck-dn); }',
    '.ck-ticker tr.ck-flat .ck-tk-line { stroke: var(--ink-dim); }',
    '.ck-ticker tr.ck-na .ck-tk-line { stroke: var(--ck-na); }',
    '.ck-ticker tr.ck-up .ck-tk-head { fill: var(--ck-up); }',
    '.ck-ticker tr.ck-dn .ck-tk-head { fill: var(--ck-dn); }',
    '.ck-ticker tr.ck-flat .ck-tk-head { fill: var(--ink-dim); }',
    '.ck-ticker tr.ck-na .ck-tk-head { fill: var(--ck-na); }',

    /* Column switches. Hiding with CSS rather than by rebuilding the table keeps every value the
       card ever shows escaped once, at build time, and keeps the script incapable of writing
       markup at all. */
    '.ck-ticker[data-last="off"] .ck-tk-c-last { display: none; }',
    '.ck-ticker[data-change="off"] .ck-tk-c-chg { display: none; }',
    '.ck-ticker[data-percent="off"] .ck-tk-c-pct { display: none; }',
    '.ck-ticker[data-spark="off"] .ck-tk-c-spark { display: none; }',

    '.ck-ticker[data-compact="on"] .ck-tk td { padding-top: 2px; padding-bottom: 2px; }',
    '.ck-ticker[data-compact="on"] .ck-tk-name { display: none; }',
    /* 64x16 keeps the 4:1 of the viewBox exactly, so the compact sparkline is the same drawing
       smaller rather than the same drawing squashed — a non-uniform scale would thin the stroke
       in one axis only and the line would read as a different weight per row height. */
    '.ck-ticker[data-compact="on"] .ck-tk-spark { width: 64px; height: 16px; }',
    '.ck-ticker[data-compact="on"] .ck-tk-c-spark { width: 64px; }',

    '.ck-ticker .ck-tk-void { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); padding: 10px 0; }',

    /* kit.css stretches every settings field to its cell; a stretched checkbox is a wide hit area
       with a glyph adrift inside it, so the checkboxes opt out. */
    '.ck-ticker .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',

    /* The direction word exists for a screen reader and must not be seen or measured. `clip-path`
       rather than `display: none`, which would take it out of the accessibility tree too. */
    '.ck-ticker .ck-tk-vh {',
    '  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;',
    '  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;',
    '}',

    '.ck-ticker .ck-cap { overflow-wrap: anywhere; }',
  ];
  return rules.join('\n');
}

/**
 * The browser script: ES5-shaped, self-invoking, and safe to run before its card exists.
 *
 * It does three things and deliberately no more — flip the attributes the CSS keys off, reorder
 * rows that are already in the DOM, and keep one relative timestamp honest. It never builds
 * markup, so no value from `data` is ever escaped twice or escaped once too few times.
 *
 * @param id   the card's `data-card` value
 * @param cfg  the settled settings this card was built with
 * @param asOf the data's timestamp in epoch milliseconds, or null when there is none
 */
function script(id, cfg, asOf) {
  return `(function () {
  'use strict';

  var ID = ${jsJson(id)};
  var DEFAULTS = ${jsJson(cfg)};
  var AS_OF = ${asOf === null ? 'null' : String(asOf)};
  var SORTS = { given: 1, symbol: 1, percent: 1 };

  /**
   * How long ago the data is, in words.
   *
   * Clamped at zero because a desk and a feed do not agree about the time to the second, and
   * "in 4 seconds" is a bug report waiting to happen where "just now" is the truth.
   *
   * @example agoText(Date.now() - 300000);   // '5 min ago'
   */
  function agoText(ms) {
    var d = Math.round((Date.now() - ms) / 1000);
    if (d < 0) d = 0;
    if (d < 45) return 'just now';
    if (d < 5400) return String(Math.round(d / 60)) + ' min ago';
    if (d < 172800) return String(Math.round(d / 3600)) + ' h ago';
    return String(Math.round(d / 86400)) + ' d ago';
  }

  /** The displayed percent hung on a row, or null when the row has none. */
  function pctOf(tr) {
    var v = tr.getAttribute('data-pct');
    if (v === null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function ixOf(tr) { return Number(tr.getAttribute('data-ix')) || 0; }

  /**
   * Compare two rows under one order, always falling back to the given order.
   *
   * The tiebreak is not decoration. Without it, two rows printing the same percent could swap
   * places between renders, and a strip that reshuffles when nothing changed reads as broken.
   */
  function cmp(mode, a, b) {
    var d = 0, x, y, p, q;
    if (mode === 'symbol') {
      x = a.getAttribute('data-sym') || '';
      y = b.getAttribute('data-sym') || '';
      d = x < y ? -1 : x > y ? 1 : 0;
    } else if (mode === 'percent') {
      p = pctOf(a);
      q = pctOf(b);
      if (p === null && q === null) d = 0;
      else if (p === null) d = 1;
      else if (q === null) d = -1;
      else d = q - p;
    }
    return d !== 0 ? d : ixOf(a) - ixOf(b);
  }

  CK.build(ID, function (sec) {

    var body = sec.querySelector('.ck-tk-body');
    var rows = [];
    if (body) {
      var found = body.querySelectorAll('tr.ck-tk-row');
      for (var i = 0; i < found.length; i++) rows.push(found[i]);
    }

    /** Reorder in place. appendChild moves a node it already owns, so this is a permutation. */
    function order(mode) {
      if (!body || rows.length < 2) return;
      var arr = rows.slice();
      arr.sort(function (a, b) { return cmp(mode, a, b); });
      for (var i = 0; i < arr.length; i++) body.appendChild(arr[i]);
    }

    function flag(v) { return v ? 'on' : 'off'; }

    function apply(cfg) {
      sec.dataset.last = flag(cfg.showLast);
      sec.dataset.change = flag(cfg.showChange);
      sec.dataset.percent = flag(cfg.showPercent);
      sec.dataset.spark = flag(cfg.showSpark);
      sec.dataset.compact = flag(cfg.compact);
      var mode = SORTS[cfg.sort] ? cfg.sort : 'given';
      sec.dataset.sort = mode;
      order(mode);
    }

    CK.settings(sec, DEFAULTS, apply);

    /* CK.timer and not setInterval, and not CK.once around a setInterval either. CK.once keys off
       the ELEMENT, and a <main> swap hands this builder a brand new section with an empty dataset
       — so the guard passes, a second interval starts, and the first one keeps running against a
       detached node. CK.timer is keyed by name in a registry that outlives the DOM, so the swap
       replaces rather than stacks.

       The callback re-finds the card instead of closing over the section for the same reason:
       between a swap and the builder replay, the node this closure captured is already garbage. */
    if (AS_OF !== null) {
      CK.timer(ID + ':asof', 60000, function () {
        var live = CK.card(ID);
        if (!live) return;
        var el = live.querySelector('.ck-tk-ago');
        if (el) el.textContent = agoText(AS_OF);
      });
    }
  });
})();`;
}

/**
 * Read a caller's `asOf` into epoch milliseconds.
 *
 * Accepts a number of milliseconds or anything `Date` can parse, and returns null for everything
 * else — including the empty string, which `Date` reads as invalid but some engines have read as
 * the epoch. A null here means the card simply does not claim a time, which is the correct
 * behaviour for data that did not carry one.
 *
 * @example when('2026-08-29T12:00:00Z') === Date.parse('2026-08-29T12:00:00Z');   // true
 * @example when('nonsense');   // null
 */
function when(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Build one ticker card.
 *
 * @param id    unique on the desk; becomes `data-card` and the settings storage key
 * @param title the card's heading, rendered as plain text
 * @param data  `{ rows, asOf }`; every value in it is untrusted and escaped. An optional
 *              `data.settings` seeds the panel, so a descriptor can ship a card already sorted by
 *              percent without the viewer having to ask for it
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup, scoped CSS, a classic script
 *
 * @example
 * const card = build({ id: 'watch', title: 'Watchlist', ord: 3, data: {
 *   rows: [{ symbol: 'AAPL', name: 'Apple', last: 231.4, prevClose: 228.9, series: [229, 231.4] }],
 *   asOf: '2026-08-29T20:00:00Z'
 * } });
 * card.html.indexOf('data-card="watch"') > 0;   // true
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'ticker' : id);
  const heading = String(title == null ? 'Ticker' : title);
  const d = data && typeof data === 'object' ? data : {};

  const raw = Array.isArray(d.rows) ? d.rows : [];
  const rows = raw.map(model);

  /* One currency is stated once in the caption; more than one has to be stated per row, because a
     column of numbers in two currencies that does not say so is a column of numbers that lies. */
  const currencies = [];
  for (const r of rows) {
    if (r.currency && !currencies.includes(r.currency)) currencies.push(r.currency);
  }

  const cfg = settle(d.settings);
  const asOf = when(d.asOf);

  return {
    json: {
      id: cardId, type: meta.name, title: heading,
      ord: ord == null ? null : ord,
      settings: cfg, rows: rows.length,
    },
    html: markup(cardId, heading, cfg, rows, currencies, asOf),
    css: styles(),
    js: script(cardId, cfg, asOf),
  };
}

export default { meta, defaults, build };
