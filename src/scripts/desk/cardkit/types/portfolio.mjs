/**
 * @file cardkit card type: `portfolio` — holdings with allocation and unrealised P&L: a table of
 * positions, a hand-drawn donut beside it, and a totals row that adds up.
 *
 * Why a card type: the hand-written version of this card shipped a totals row that disagreed with
 * the column above it by four cents, because every cell was rounded for display and the total was
 * the sum of the unrounded floats. That is the single most embarrassing bug a finance card can
 * have — a reader who adds the column up is right and the card is wrong — so the rounding
 * decision is made once here, in {@link minor}, and every total afterwards is integer arithmetic
 * over exactly the integers the rows display.
 *
 * The other thing this file exists to get right is the donut. An arc of exactly 360 degrees has
 * identical start and end points and SVG draws nothing at all for it, so a portfolio with one
 * holding — the commonest possible portfolio — renders as an empty ring in every naive
 * implementation. That case is handled explicitly in {@link donut}.
 *
 * Everything the browser sees is escaped at build time. The emitted script flips attributes,
 * reorders existing rows, and copies text out of data attributes with `textContent`; it never
 * builds markup, so this card's injection surface is the build step and nothing else.
 *
 * @see ../CONTRACT.md — `shape` is a string, `defaults` is an object; both are honoured here
 * @see ../kit.js      — `CK.hue`, `CK.fmt`, `CK.esc`, `CK.settings`, `CK.build`
 * @see ../kit.css     — `.ck-legend`, `.ck-scroll`, `.ck-gear`, `.ck-set`, `.ck-cap`
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
 * @example loadKit().hue(0);   // 'var(--ck-s1)'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/portfolio: cannot read ' + where.pathname + ' — ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/portfolio: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting the portfolio understands, with the value that stands when nothing is stored.
 *
 * `showCash` defaults on because an allocation view that silently omits the cash sleeve is the
 * classic way to make a book look more invested than it is.
 *
 * @example DEFAULTS.sort;   // 'weight'
 */
const DEFAULTS = {
  group:    'sector',
  showCash: true,
  sort:     'weight',
};

/** How the allocation view may be grouped. Anything else falls back rather than blanking. */
const GROUPS = ['sector', 'symbol'];

/** The orders a viewer may ask for. */
const SORTS = ['weight', 'symbol', 'gain'];

/**
 * What this card type is, for the desk's type picker and for tooling.
 *
 * `shape` is a string and `defaults` is an object, per `CONTRACT.md`. `cost` is stated as
 * per-share because that is the ambiguity this card was going to be handed: a field called `cost`
 * sitting beside `last` is a price, not a basis, and reading it as a basis quietly divides every
 * gain in the book by the position size.
 *
 * @example meta.name;   // 'portfolio'
 */
export const meta = {
  name: 'portfolio',
  summary: 'Holdings with allocation and unrealised P&L: weights, a hand-drawn donut, and a totals row that adds up.',
  shape: '{ holdings: [{ symbol, qty, cost, last, sector }], cash, currency } — ' +
         'cost and last are both PER SHARE, so the basis is qty * cost; qty may be negative for a ' +
         'short; sector is optional and falls back to "unclassified" when the donut groups by it',
  category: 'part-of-a-whole',
  defaults: { ...DEFAULTS },
};

/**
 * Every setting this card understands, exported beside `meta.defaults` so a validator can check
 * the emitted panel's field names against it without building a card first.
 *
 * @example defaults.showCash;   // true
 */
export const defaults = { ...DEFAULTS };

/** The em dash as markup, for a quantity that is undefined rather than zero. */
const MDASH = '&mdash;';

/**
 * The same em dash as a bare character.
 *
 * The two forms are not interchangeable and mixing them is a real bug: values that the browser
 * swaps into a cell go in through `textContent`, which would print `&mdash;` literally, five
 * characters of ampersand and letters where a dash was meant.
 */
const MDASH_TEXT = '\u2014';

/** Money is counted in cents throughout. One place, so nothing can disagree about it. */
const MONEY_DP = 2;

/** Percentages of gain are shown to two places; weights to one, in tenths of a percent. */
const PCT_DP = 2;
const WEIGHT_DP = 1;

/** A full turn expressed in the tenths of a percent that the weights are apportioned in. */
const TENTHS = 1000;

/** Two decimal places at most, so emitted path data stays short and diffs stay readable. */
function n2(v) { return Math.round(v * 100) / 100; }

/**
 * A JSON literal safe to paste into a classic `<script>` body.
 *
 * `JSON.stringify` alone is not enough: a value containing `</script` closes the element early
 * and the rest of the card renders as text. Escaping the angle brackets — and the two line
 * separators that are newlines to a JS parser but not to JSON — closes both holes.
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

/**
 * A value's magnitude as an exact integer count of minor units at `dp` decimal places.
 *
 * This is the rounding decision, and it is deliberate rather than a `toFixed` call.
 *
 * `toFixed` is not used for money anywhere in this file for two reasons. The first is that it
 * rounds the binary double rather than the decimal the reader typed: `(1.005).toFixed(2)` is
 * `'1.00'`, because 1.005 is stored a hair below one and a half hundredths, so a cent vanishes
 * with no warning. The second is worse for this card in particular — a string is a dead end. Once
 * a row is the string `'1.01'`, the totals row has nothing left to add but the unrounded floats,
 * and it will disagree with the column printed above it.
 *
 * So every displayed quantity becomes an integer here, once, and every sum afterwards is integer
 * arithmetic over those same integers. The totals row cannot fail to reconcile, because it is
 * literally the sum of what the rows display, not a parallel calculation that happens to agree.
 *
 * The epsilon undoes exactly the representation error described above: it is scaled to the
 * magnitude of the value, so it lifts a number sitting a hair under a half up to it without ever
 * promoting one that genuinely sits below. Rounding is half away from zero, which is what every
 * accounting convention in use here does and what a reader expects of a price.
 *
 * @param value any number; non-finite input yields null so the caller can print an em dash
 * @param dp    decimal places to keep
 * @returns an integer count of minor units, or null when the value cannot be held exactly
 *
 * @example minor(1.005, 2);    // 101   — toFixed would say 100
 * @example minor(-2.675, 2);   // -268
 * @example minor(NaN, 2);      // null
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

/** Minor units back to an ordinary number. Only for display helpers that want a float. */
function fromMinor(units, dp) { return units / Math.pow(10, dp); }

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
 * {@link minor} just removed. Zero never takes a `+`: a green `+0.00` reads as a bug even when
 * the underlying move was a fraction of a cent.
 *
 * @param units integer minor units, or null for an undefined quantity
 * @param dp    the decimal places those units are counted in
 * @param sign  true to mark a positive value with a leading `+`
 * @param dash  what to return for a null; markup by default, a bare character for attributes
 *
 * @example minorText(-125000, 2, false);       // '-1,250.00'
 * @example minorText(1234, 2, true);           // '+12.34'
 * @example minorText(null, 2, false, '\u2014') // '\u2014'
 */
function minorText(units, dp, sign, dash) {
  if (units == null || !Number.isFinite(units)) return dash == null ? MDASH : dash;
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

/** A percentage in minor units, with its sign and its sign character. */
function pctText(units, dp, sign, dash) {
  if (units == null || !Number.isFinite(units)) return dash == null ? MDASH : dash;
  return minorText(units, dp, sign, dash) + '%';
}

/** A finite number, or null. */
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/** `up`, `dn`, `flat` or `na`, taken from a displayed integer so the class matches the number. */
function dirOf(units) {
  if (units == null) return 'na';
  return units > 0 ? 'up' : units < 0 ? 'dn' : 'flat';
}

/**
 * Split a total into integer parts that sum to it exactly, by largest remainder.
 *
 * A weight column that reads 41.7 / 33.3 / 25.1 and totals 100.0 is a column somebody will add up
 * and find wrong by a tenth. Rounding each share independently loses or gains those tenths;
 * apportioning them puts every lost tenth back onto the shares that were rounded down hardest,
 * which is the standard largest-remainder method and the only one that both sums exactly and
 * never moves a share by more than one unit from its true value.
 *
 * Negative shares are handled without special-casing: `Math.floor` runs toward negative infinity,
 * so a remainder is still in [0, 1) and the deficit is still the number of units to hand back.
 * A net-short book therefore still totals exactly 100.0%.
 *
 * @param values the shares, in any consistent unit; may be negative
 * @param total  their sum, in the same unit; must not be zero
 * @param units  the whole to divide, e.g. 1000 for tenths of a percent
 * @returns one integer per input, summing to exactly `units`
 *
 * @example apportion([1, 1, 1], 3, 1000);   // [334, 333, 333]
 * @example apportion([7], 7, 1000);         // [1000]
 */
function apportion(values, total, units) {
  if (values.length === 0 || total === 0) return values.map(() => 0);

  const exact = values.map((v) => v * units / total);
  const out = exact.map((v) => Math.floor(v));

  let deficit = units - out.reduce((a, b) => a + b, 0);
  if (deficit < 0) deficit = 0;
  if (deficit > values.length) deficit = values.length;

  /* Ties go to the earlier index, which is the incoming order — so the same input always produces
     the same column and a re-render never silently moves a tenth from one row to another. */
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));

  for (let k = 0; k < deficit; k++) out[order[k].i] += 1;
  return out;
}

/**
 * One holding's model: everything the markup needs, all arithmetic already done in cents.
 *
 * The gain is the difference of the two DISPLAYED integers, not of the raw floats, so a reader
 * can subtract the value column from the basis column in their head and get the gain column. The
 * percent divides by the MAGNITUDE of the basis, so a short that profits reports a positive
 * return rather than a negative one — dividing by a negative basis reports every winning short as
 * a loss, which is the kind of wrong that survives review because the sign looks plausible.
 *
 * A missing number is read as zero rather than dropping the row, and the card says how many rows
 * that happened to. The alternative — showing the row with em dashes and excluding it from the
 * totals — produces a book whose gain no longer equals its value minus its basis, and a totals
 * row that does not reconcile is worse than a caption that admits to a gap in the data.
 *
 * @param raw a caller's holding; every field is untrusted and may be absent
 * @param ix  the holding's position in the given order, kept as a stable sort tiebreak
 *
 * @example model({ symbol: 'X', qty: -10, cost: 100, last: 90 }, 0).gainMinor;   // 10000
 * @example model({ symbol: 'X', qty: 0, cost: 5, last: 6 }, 0).gainPctMinor;     // null
 */
function model(raw, ix) {
  const r = raw && typeof raw === 'object' ? raw : {};

  const qtyRaw = num(r.qty);
  const costRaw = num(r.cost);
  const lastRaw = num(r.last);
  const incomplete = qtyRaw === null || costRaw === null || lastRaw === null;

  const qty = qtyRaw === null ? 0 : qtyRaw;
  const cost = costRaw === null ? 0 : costRaw;
  const last = lastRaw === null ? 0 : lastRaw;

  const basisMinor = minor(qty * cost, MONEY_DP);
  const valueMinor = minor(qty * last, MONEY_DP);

  /* A row only counts toward the totals when both of its money cells are exactly representable.
     They both print em dashes when they are not, so the visible column still sums to the visible
     total — an em dash contributes nothing to either side of the check. */
  const counted = basisMinor !== null && valueMinor !== null;

  const gainMinor = counted ? valueMinor - basisMinor : null;
  const gainPctMinor = !counted || basisMinor === 0
    ? null
    : minor(gainMinor / Math.abs(basisMinor) * 100, PCT_DP);

  const symbol = String(r.symbol == null ? '' : r.symbol);
  const sector = r.sector == null ? '' : String(r.sector).trim();

  return {
    ix, symbol, sector, incomplete, counted,
    sortKey: symbol.toUpperCase(),
    qty, cost, last,
    basisMinor, valueMinor, gainMinor, gainPctMinor,
    isCash: false,
  };
}

/**
 * The cash sleeve as a row, so the value column and the allocation both include it.
 *
 * Cash has no cost basis and no unrealised gain — it is worth what it is — so those three cells
 * are em dashes rather than zeroes. That is not cosmetic: a zero basis would drag the book's
 * return percent toward nothing, and a zero gain would claim cash had been held and not moved
 * when in fact it was never a position at all. An em dash contributes nothing to a column sum, so
 * the totals row keeps reconciling with cash shown or hidden.
 *
 * @param cashMinor the cash balance in cents
 * @param ix        a sort tiebreak past the last holding
 */
function cashRowModel(cashMinor, ix) {
  return {
    ix, symbol: 'cash', sector: 'cash', sortKey: 'CASH',
    incomplete: false, counted: false,
    qty: null, cost: null, last: null,
    basisMinor: null, valueMinor: cashMinor, gainMinor: null, gainPctMinor: null,
    isCash: true,
  };
}

/**
 * The book's totals, computed twice — once with the cash sleeve and once without.
 *
 * Both are computed at build time and both are carried in the markup, because the alternative is
 * recomputing money in the browser, and two implementations of the same rounding is exactly how
 * the two halves of a card start disagreeing.
 *
 * `gainMinor` is the sum of the row gains and is therefore identically `valueOff - basis`; it is
 * summed rather than derived so that the invariant is a fact about the displayed column and not a
 * claim about it.
 *
 * @param rows holding models, cash excluded
 * @param cashMinor the cash balance in cents
 */
function totals(rows, cashMinor) {
  let basis = 0, valueOff = 0, gain = 0;
  for (const r of rows) {
    if (!r.counted) continue;
    basis += r.basisMinor;
    valueOff += r.valueMinor;
    gain += r.gainMinor;
  }
  const gainPct = basis === 0 ? null : minor(gain / Math.abs(basis) * 100, PCT_DP);
  return { basis, gain, gainPct, valueOff, valueOn: valueOff + cashMinor };
}

/**
 * The weight column for one cash state, apportioned so that it sums to exactly 100.0%.
 *
 * Rows that are not counted get no weight at all — they have no displayed value to take a share
 * of — and are left out of the apportionment, so the tenths still add to a thousand.
 *
 * A book worth nothing or less has no weights at all, and that is a deliberate refusal rather
 * than a missing case. The arithmetic is happy to divide by a negative total, but the column it
 * produces is a trap: a net-short book gives its short position a weight of +133% and its long
 * position -18%, because both signs flipped against a negative denominator. Every reader would
 * read that backwards, so the card declines to answer instead of answering misleadingly. A book
 * that is merely net long WITH a short in it still works and still sums to 100%, and there the
 * negative weight on the short is the standard and correct presentation.
 *
 * @param rows      every row that can appear, cash included
 * @param withCash  whether the cash row is on the desk for this variant
 * @param denom     the value total for this variant, in cents
 * @returns a map from row index to tenths of a percent, or null when there is no denominator
 *
 * @example weights([], true, 0);   // null
 */
function weights(rows, withCash, denom) {
  if (!(denom > 0)) return null;

  const live = rows.filter((r) => (r.isCash ? withCash : r.counted));
  if (live.length === 0) return null;

  const tenths = apportion(live.map((r) => r.valueMinor), denom, TENTHS);

  const out = new Map();
  live.forEach((r, i) => out.set(r.ix, tenths[i]));
  return out;
}

/** The label a row contributes to the allocation under one grouping. */
function groupKey(row, group) {
  if (row.isCash) return 'cash';
  if (group === 'symbol') return row.symbol || 'unnamed';
  return row.sector || 'unclassified';
}

/* At most eight arcs, because `CK.hue` cycles at eight and a ninth segment would repeat the first
   one's colour in the same picture. The eighth slot is the overflow bucket rather than a real
   group, so seven groups are named and everything else is honestly labelled. */
const MAX_GROUPS = 8;

/**
 * The allocation groups for one grouping and one cash state, biggest first.
 *
 * The arc magnitude is the ABSOLUTE net value of the group. A pie of signed numbers has no
 * geometry — a short position is a negative arc, and there is no such thing — so the donut shows
 * gross exposure and any group that is net short is labelled as one in the legend. Folding the
 * overflow uses the sum of the magnitudes rather than the magnitude of the sum, so the total the
 * percentages divide by is preserved and a long and a short in the overflow do not cancel into a
 * bucket that claims to be nothing.
 *
 * @param rows     every row that can appear, cash included
 * @param group    `sector` or `symbol`
 * @param withCash whether the cash sleeve takes a slice
 * @returns `[{ label, mag, short }]`, longest first, at most {@link MAX_GROUPS} entries
 */
function groupsFor(rows, group, withCash) {
  const acc = new Map();
  for (const r of rows) {
    if (r.isCash && !withCash) continue;
    if (!r.isCash && !r.counted) continue;
    const k = groupKey(r, group);
    acc.set(k, (acc.get(k) || 0) + r.valueMinor);
  }

  const list = [];
  for (const [label, net] of acc) list.push({ label, net, mag: Math.abs(net), short: net < 0 });
  list.sort((a, b) => (b.mag - a.mag) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  if (list.length <= MAX_GROUPS) return list;

  const kept = list.slice(0, MAX_GROUPS - 1);
  const rest = list.slice(MAX_GROUPS - 1);
  const mag = rest.reduce((a, b) => a + b.mag, 0);
  kept.push({ label: rest.length + ' more', net: mag, mag, short: false });
  return kept;
}

/* Donut geometry, in the 100-unit square every drawn thing on this desk uses. The radius is the
   CENTRE of the ring and the stroke is its thickness, which is what makes the 360-degree case
   expressible at all: a stroked circle is a full ring, where a filled path is not. */
const DONUT_R = 34;
const DONUT_C = 50;

/**
 * One point on the ring, in SVG coordinates, from an angle measured in tenths of a turn.
 *
 * Zero is twelve o'clock, because a reader looking for the largest slice looks there first.
 */
function ringPoint(tenths) {
  const rad = (tenths / TENTHS) * Math.PI * 2 - Math.PI / 2;
  return [n2(DONUT_C + DONUT_R * Math.cos(rad)), n2(DONUT_C + DONUT_R * Math.sin(rad))];
}

/**
 * The allocation donut for one grouping and one cash state.
 *
 * The classic donut bug lives here and is handled explicitly. An SVG elliptical arc is defined by
 * its endpoints; a segment covering the whole circle has the same point at both ends, and the
 * specification says an arc whose endpoints are identical is simply omitted from the path. So the
 * commonest portfolio there is — one holding, one hundred percent — draws nothing whatsoever, and
 * because the failure is silent it usually ships. A full turn is therefore emitted as a stroked
 * `<circle>`, which has no endpoints to collapse.
 *
 * The arcs are laid out from the same apportioned tenths as the legend, not from the raw ratios,
 * so the segments sum to exactly one turn and no arc can disagree with the percentage printed
 * next to it.
 *
 * A zero-magnitude group is skipped rather than drawn, because a zero-length arc is a stroked
 * point that the round cap would render as a dot floating on the ring.
 *
 * @param groups from {@link groupsFor}
 * @param tenths one apportioned share per group, summing to {@link TENTHS}, or null
 * @param label  the accessible description of the whole picture
 * @param centre the text for the hole: the book's value, compactly
 * @param key    the `data-k` variant this drawing belongs to
 *
 * @example donut([{ label: 'A', mag: 5 }], [1000], 'one', '5', 'symbol-off').indexOf('<circle class="ck-pf-seg"') > 0;   // true
 */
function donut(groups, tenths, label, centre, key) {
  const parts = ['<circle class="ck-pf-track" cx="' + DONUT_C + '" cy="' + DONUT_C + '" r="' + DONUT_R + '"/>'];

  if (tenths) {
    let cum = 0;
    for (let i = 0; i < groups.length; i++) {
      const span = tenths[i];
      if (span <= 0) { continue; }

      const s = ' class="ck-pf-seg" data-s="' + ((i % 8) + 1) + '"';

      if (span >= TENTHS) {
        /* A full turn. See the note above: an arc path with identical endpoints draws nothing, so
           the whole ring is a circle and not a path at all. */
        parts.push('<circle' + s + ' cx="' + DONUT_C + '" cy="' + DONUT_C + '" r="' + DONUT_R + '"/>');
      } else {
        const [x0, y0] = ringPoint(cum);
        const [x1, y1] = ringPoint(cum + span);
        const large = span * 2 > TENTHS ? 1 : 0;
        parts.push('<path' + s + ' d="M' + x0 + ' ' + y0 + 'A' + DONUT_R + ' ' + DONUT_R +
                   ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + '"/>');
      }
      cum += span;
    }
  }

  parts.push('<text class="ck-pf-hole" x="' + DONUT_C + '" y="' + (DONUT_C - 1) +
             '" text-anchor="middle" dominant-baseline="central">' + CK.esc(centre) + '</text>');
  parts.push('<text class="ck-pf-holelab" x="' + DONUT_C + '" y="' + (DONUT_C + 10) +
             '" text-anchor="middle" dominant-baseline="central">value</text>');

  return '<svg class="ck-pf-donut" data-k="' + key + '" viewBox="0 0 100 100" role="img" ' +
         'aria-label="' + CK.esc(label) + '">' + parts.join('') + '</svg>';
}

/**
 * The legend beside one donut variant, using the kit's shared legend furniture.
 *
 * The swatch index matches the arc's, and both come from the same `CK.hue` cycle, so a colour in
 * the legend is the colour in the ring by construction rather than by two lists staying in step.
 */
function legend(groups, tenths, key) {
  const items = groups.map((g, i) => {
    const share = tenths ? pctText(tenths[i], WEIGHT_DP, false) : MDASH;
    const short = g.short ? ' <span class="ck-pf-short">short</span>' : '';
    return '<span><i data-s="' + ((i % 8) + 1) + '"></i>' + CK.esc(g.label) + ' ' + share + short + '</span>';
  }).join('');

  return '<div class="ck-legend ck-pf-key" data-k="' + key + '">' +
         (items || '<span>nothing allocated</span>') + '</div>';
}

/**
 * Fold a caller's seed onto the defaults, rejecting anything the card cannot honour.
 *
 * Coercive rather than strict: a descriptor may be hand-edited, and a typo in `group` should give
 * a working book grouped the default way rather than an empty box.
 *
 * @example settle({ group: 'nope' }).group;   // 'sector'
 */
function settle(seed) {
  const out = { ...DEFAULTS };
  if (seed && typeof seed === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(seed, k) && seed[k] != null) out[k] = seed[k];
    }
  }
  out.showCash = !!out.showCash;
  if (!GROUPS.includes(out.group)) out.group = DEFAULTS.group;
  if (!SORTS.includes(out.sort)) out.sort = DEFAULTS.sort;
  return out;
}

/** `<option>` markup with the settled value pre-selected, so a static render is already correct. */
function options(pairs, chosen) {
  return pairs.map(([v, label]) =>
    '<option value="' + CK.esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' + CK.esc(label) + '</option>'
  ).join('');
}

/**
 * One `<tr>`, fully escaped, carrying both cash states' weights as attributes.
 *
 * The two weights are precomputed rather than recalculated in the browser, and the browser copies
 * one of them into the cell with `textContent`. That keeps every number in this card the product
 * of one rounding implementation, and it keeps the emitted script incapable of writing markup.
 *
 * @param row  a model from {@link model} or {@link cashRowModel}
 * @param qtyDp the decimal places the whole quantity column is showing
 * @param wOn  tenths of a percent with cash shown, or null
 * @param wOff tenths of a percent with cash hidden, or null
 * @param showCash the seeded cash state, so a render with no script running is already right
 */
function rowHtml(row, qtyDp, wOn, wOff, showCash) {
  const gainDir = dirOf(row.gainMinor);

  const wOnText = wOn == null ? MDASH_TEXT : pctText(wOn, WEIGHT_DP, false, MDASH_TEXT);
  const wOffText = wOff == null ? MDASH_TEXT : pctText(wOff, WEIGHT_DP, false, MDASH_TEXT);

  const qtyCell = row.isCash
    ? MDASH
    : minorText(minor(row.qty, qtyDp), qtyDp, false);

  /* The per-share numbers live in a title rather than in two more columns. Seven columns is
     already at the edge of what a desk card can align, and the basis and the last price are what
     a reader wants to check, not what they want to scan.

     Every dash in here is the bare character, not the entity: the whole string goes through
     CK.esc on its way into an attribute, and an entity would come back out as five literal
     characters of ampersand and letters. */
  const tip = row.isCash
    ? 'cash balance'
    : row.symbol + ' — ' + minorText(minor(row.qty, qtyDp), qtyDp, false, MDASH_TEXT) +
      ' at ' + minorText(minor(row.cost, 4), 4, false, MDASH_TEXT) + ' cost, last ' +
      minorText(minor(row.last, 4), 4, false, MDASH_TEXT);

  const sector = !row.isCash && row.sector
    ? '<span class="ck-pf-sec">' + CK.esc(row.sector) + '</span>'
    : '';

  return '<tr class="ck-pf-row' + (row.isCash ? ' ck-pf-cash' : '') + '"' +
           (row.isCash && !showCash ? ' hidden' : '') +
           ' data-ix="' + row.ix + '"' +
           ' data-sym="' + CK.esc(row.sortKey) + '"' +
           (row.valueMinor == null ? '' : ' data-v="' + row.valueMinor + '"') +
           (row.gainMinor == null ? '' : ' data-g="' + row.gainMinor + '"') + '>' +
         '<th class="ck-pf-c-sym" scope="row" title="' + CK.esc(tip) + '">' +
           '<span class="ck-pf-sym">' + CK.esc(row.symbol) + '</span>' + sector + '</th>' +
         '<td class="ck-pf-c-qty">' + qtyCell + '</td>' +
         '<td class="ck-pf-c-basis">' + minorText(row.basisMinor, MONEY_DP, false) + '</td>' +
         '<td class="ck-pf-c-val">' + minorText(row.valueMinor, MONEY_DP, false) + '</td>' +
         '<td class="ck-pf-c-gain ck-' + gainDir + '">' + minorText(row.gainMinor, MONEY_DP, true) + '</td>' +
         '<td class="ck-pf-c-gpct ck-' + gainDir + '">' + pctText(row.gainPctMinor, PCT_DP, true) + '</td>' +
         '<td class="ck-pf-c-w" data-w1="' + CK.esc(wOnText) + '" data-w0="' + CK.esc(wOffText) + '">' +
           CK.esc(showCash ? wOnText : wOffText) + '</td>' +
         '</tr>';
}

/**
 * The totals row.
 *
 * Every cell here is a sum of the integers the rows above print, so the column adds up by
 * construction. The book's return divides the summed gain by the magnitude of the summed basis,
 * which means a reader can take the two printed totals, divide them, and get the printed percent
 * — the check anyone auditing a finance card does first.
 */
function totalsHtml(t, wOn, wOff, showCash) {
  const gainDir = dirOf(t.gain);
  const vOn = minorText(t.valueOn, MONEY_DP, false, MDASH_TEXT);
  const vOff = minorText(t.valueOff, MONEY_DP, false, MDASH_TEXT);

  return '<tfoot><tr class="ck-pf-tot">' +
         '<th class="ck-pf-c-sym" scope="row">total</th>' +
         '<td class="ck-pf-c-qty">' + MDASH + '</td>' +
         '<td class="ck-pf-c-basis">' + minorText(t.basis, MONEY_DP, false) + '</td>' +
         '<td class="ck-pf-c-val" data-v1="' + CK.esc(vOn) + '" data-v0="' + CK.esc(vOff) + '">' +
           CK.esc(showCash ? vOn : vOff) + '</td>' +
         '<td class="ck-pf-c-gain ck-' + gainDir + '">' + minorText(t.gain, MONEY_DP, true) + '</td>' +
         '<td class="ck-pf-c-gpct ck-' + gainDir + '">' + pctText(t.gainPct, PCT_DP, true) + '</td>' +
         '<td class="ck-pf-c-w" data-w1="' + CK.esc(wOn) + '" data-w0="' + CK.esc(wOff) + '">' +
           CK.esc(showCash ? wOn : wOff) + '</td>' +
         '</tr></tfoot>';
}

/**
 * The card's markup: heading, gear, settings panel, the book, the allocation, and a caption.
 *
 * All four allocation variants are emitted and CSS picks one. The alternative is redrawing arcs
 * in the browser, which means a second implementation of the apportionment — and the moment there
 * are two, the legend and the ring start disagreeing about a tenth of a percent.
 *
 * The gear button is emitted empty on purpose: `CK.settings` fills it with the kit's drawn gear.
 */
function markup(id, title, cfg, view) {
  const f = (name) => CK.esc(id) + '-' + name;

  const body = view.rows.map((r) =>
    rowHtml(r, view.qtyDp,
      view.wOn && view.wOn.has(r.ix) ? view.wOn.get(r.ix) : null,
      view.wOff && view.wOff.has(r.ix) ? view.wOff.get(r.ix) : null,
      cfg.showCash)
  ).join('');

  const totWOn = view.wOn ? pctText(TENTHS, WEIGHT_DP, false, MDASH_TEXT) : MDASH_TEXT;
  const totWOff = view.wOff ? pctText(TENTHS, WEIGHT_DP, false, MDASH_TEXT) : MDASH_TEXT;

  const head =
    '<thead><tr>' +
    '<th class="ck-pf-c-sym" scope="col">holding</th>' +
    '<th class="ck-pf-c-qty" scope="col">qty</th>' +
    '<th class="ck-pf-c-basis" scope="col">basis</th>' +
    '<th class="ck-pf-c-val" scope="col">value</th>' +
    '<th class="ck-pf-c-gain" scope="col">gain</th>' +
    '<th class="ck-pf-c-gpct" scope="col">gain %</th>' +
    '<th class="ck-pf-c-w" scope="col">weight</th>' +
    '</tr></thead>';

  const table =
    '<div class="ck-pf-table ck-scroll"><table class="ck-pf-t">' + head +
    '<tbody class="ck-pf-body">' + body + '</tbody>' +
    totalsHtml(view.totals, totWOn, totWOff, cfg.showCash) +
    '</table></div>';

  const alloc =
    '<div class="ck-pf-alloc">' + view.donuts.join('') + view.legends.join('') + '</div>';

  const shell = view.empty
    ? '<div class="ck-pf-void">no holdings and no cash &mdash; nothing to allocate</div>'
    : '<div class="ck-pf-body-row">' + table + alloc + '</div>';

  const bad = view.incomplete === 0 ? ''
    : ' <span class="ck-aside">' + view.incomplete +
      (view.incomplete === 1 ? ' holding was' : ' holdings were') +
      ' missing a number, read as zero</span>';

  const cur = view.currency ? ' <i>' + CK.esc(view.currency) + '</i>' : '';

  /* With cash on the desk, the totals row reads basis -900, value -675, gain +125 and looks like
     it does not add up — because it does not: the cash sleeve is in the value and, correctly, in
     neither the basis nor the gain. That is a footnote a reader needs in front of them and not
     behind the gear, so it rides the caption and appears with the sleeve it explains. */
  const cashNote = view.cashMinor === 0 ? ''
    : ' <span class="ck-aside ck-pf-cashnote">value includes the cash sleeve; basis and gain cover the invested book only</span>';

  const caption =
    '<div class="ck-cap"><b>' + view.holdings +
    (view.holdings === 1 ? ' holding' : ' holdings') + '</b>' + cur + cashNote + bad + '</div>';

  return '<section data-card="' + CK.esc(id) + '" class="ck-pf"' +
    ' data-group="' + CK.esc(cfg.group) + '"' +
    ' data-cash="' + (cfg.showCash ? 'on' : 'off') + '"' +
    ' data-sort="' + CK.esc(cfg.sort) + '">' +

    '<h2>' + CK.esc(title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="portfolio settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('group') + '">group by</label>' +
      '<select id="' + f('group') + '" name="group">' +
        options([['sector', 'sector'], ['symbol', 'symbol']], cfg.group) +
      '</select>' +
      '<label for="' + f('showCash') + '">show cash</label>' +
      '<input id="' + f('showCash') + '" name="showCash" type="checkbox"' + (cfg.showCash ? ' checked' : '') + '>' +
      '<label for="' + f('sort') + '">order</label>' +
      '<select id="' + f('sort') + '" name="sort">' +
        options([['weight', 'by weight'], ['symbol', 'by symbol'], ['gain', 'by gain']], cfg.sort) +
      '</select>' +
      '<p class="ck-set-foot">Weights and the value total move with the cash sleeve; basis and gain do not, because cash has neither.</p>' +
    '</div>' +

    shell + caption +
  '</section>';
}

/**
 * Every rule scoped under `.ck-pf`.
 *
 * There is not one literal colour in here. The desk is a single document open in a browser and an
 * editor that want opposite themes, so a hex would be wrong in exactly one of them, and
 * `prefers-color-scheme` is untouched because the OS cannot give two viewers different answers.
 *
 * The series colours come through `CK.hue`, the same call the arcs are indexed by, so the swatch
 * and the segment cannot drift apart.
 */
function styles() {
  const rules = [
    '.ck-pf {',
    '  position: relative;',
    '  --ck-up: var(--ck-s4);',
    '  --ck-dn: var(--ck-s1);',
    '  --ck-na: var(--ink-faint);',
    '}',

    '.ck-pf .ck-pf-body-row { display: flex; flex-wrap: wrap; gap: 14px 18px; align-items: flex-start; }',
    /* min-width:0 is what stops a wide table from pushing the flex item past the card and giving
       the whole page a horizontal scrollbar; .ck-scroll then takes the overflow itself. */
    '.ck-pf .ck-pf-table { flex: 1 1 320px; min-width: 0; }',
    '.ck-pf .ck-pf-alloc { flex: 0 1 180px; min-width: 150px; }',

    '.ck-pf .ck-pf-t {',
    '  width: 100%; border-collapse: collapse;',
    '  font-family: var(--mono); font-size: 11px; color: var(--ink);',
    '  font-variant-numeric: tabular-nums;',
    '}',
    '.ck-pf .ck-pf-t th, .ck-pf .ck-pf-t td { white-space: nowrap; text-align: right; }',
    '.ck-pf .ck-pf-t thead th {',
    '  font: 700 9px/1 var(--ui); letter-spacing: .08em; text-transform: uppercase;',
    '  color: var(--ink-faint); padding: 0 0 5px;',
    '}',
    '.ck-pf .ck-pf-t td, .ck-pf .ck-pf-t tbody th { padding: 4px 0; border-top: 1px solid var(--hairline); }',
    '.ck-pf .ck-pf-t th + th, .ck-pf .ck-pf-t td + td, .ck-pf .ck-pf-t th + td { padding-left: 11px; }',
    '.ck-pf .ck-pf-t tbody tr:first-child > * { border-top-color: var(--rule); }',

    '.ck-pf .ck-pf-c-sym { text-align: left; font-weight: 400; }',
    '.ck-pf .ck-pf-sym { color: var(--ink); font-weight: 700; letter-spacing: .02em; }',
    '.ck-pf .ck-pf-sec {',
    '  display: block; font-family: var(--ui); font-size: 9.5px; color: var(--ink-faint); margin-top: 1px;',
    '  max-width: 16ch; overflow: hidden; text-overflow: ellipsis;',
    '}',

    /* The totals row is the one a reader checks, so it is separated by a real rule rather than a
       hairline and set in the ink the body text uses. */
    '.ck-pf .ck-pf-t tfoot th, .ck-pf .ck-pf-t tfoot td { border-top: 1px solid var(--rule); padding-top: 6px; }',
    '.ck-pf .ck-pf-tot .ck-pf-c-sym {',
    '  font: 700 9px/1 var(--ui); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-dim);',
    '}',

    /* Sign is carried in the text by the leading + or -, so colour is a second channel and never
       the only one. A reader in greyscale still reads the column correctly. */
    '.ck-pf .ck-up { color: var(--ck-up); }',
    '.ck-pf .ck-dn { color: var(--ck-dn); }',
    '.ck-pf .ck-flat { color: var(--ink-dim); }',
    '.ck-pf .ck-na { color: var(--ck-na); }',

    '.ck-pf .ck-pf-donut { width: 100%; max-width: 180px; height: auto; display: block; margin: 0 auto; }',
    '.ck-pf .ck-pf-seg { fill: none; stroke-width: 15; }',
    '.ck-pf .ck-pf-track { fill: none; stroke: var(--well); stroke-width: 15; }',
    '.ck-pf .ck-pf-hole {',
    '  font-family: var(--disp); font-size: 13px; fill: var(--ink); font-variant-numeric: tabular-nums;',
    '}',
    '.ck-pf .ck-pf-holelab {',
    '  font-family: var(--ui); font-size: 6.5px; fill: var(--ink-faint);',
    '  letter-spacing: .1em; text-transform: uppercase;',
    '}',
    '.ck-pf .ck-pf-short { color: var(--ck-dn); }',

    /* The cash footnote belongs to the cash sleeve and vanishes with it, rather than explaining a
       row that is not on the desk. */
    '.ck-pf .ck-pf-cashnote { display: none; }',
    '.ck-pf[data-cash="on"] .ck-pf-cashnote { display: inline; }',

    /* Four allocation variants are in the markup and exactly one is shown. Toggling an attribute
       is cheaper than redrawing, and — more to the point — it means the arcs and the legend can
       only ever have come from the same apportionment. */
    '.ck-pf .ck-pf-donut, .ck-pf .ck-pf-key { display: none; }',
  ];

  for (const g of GROUPS) {
    for (const c of ['on', 'off']) {
      const sel = '.ck-pf[data-group="' + g + '"][data-cash="' + c + '"] ';
      rules.push(sel + '.ck-pf-donut[data-k="' + g + '-' + c + '"] { display: block; }');
      rules.push(sel + '.ck-pf-key[data-k="' + g + '-' + c + '"] { display: flex; }');
    }
  }

  /* Segment and swatch take their colour from the same CK.hue index the markup was numbered with,
     so a ring colour and its legend chip cannot come apart. */
  for (let i = 1; i <= 8; i++) {
    rules.push('.ck-pf .ck-pf-seg[data-s="' + i + '"] { stroke: ' + CK.hue(i - 1) + '; }');
    rules.push('.ck-pf .ck-legend i[data-s="' + i + '"] { background: ' + CK.hue(i - 1) + '; }');
  }

  rules.push('.ck-pf .ck-pf-void { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); padding: 10px 0; }');

  /* kit.css stretches every settings field to its cell; a stretched checkbox is a wide hit area
     with a glyph adrift inside it, so the checkbox opts out. */
  rules.push('.ck-pf .ck-set input[type="checkbox"] { width: auto; justify-self: start; }');
  rules.push('.ck-pf .ck-cap { overflow-wrap: anywhere; }');

  return rules.join('\n');
}

/**
 * The browser script: ES5-shaped, self-invoking, and safe to run before its card exists.
 *
 * It does exactly three things — flip the two attributes the CSS keys off, swap the precomputed
 * weight text into the cells, and reorder rows that already exist. No money is calculated here,
 * because a second rounding implementation is how the two halves of a finance card start
 * disagreeing by a cent.
 *
 * @param id  the card's `data-card` value
 * @param cfg the settled settings this card was built with
 */
function script(id, cfg) {
  return `(function () {
  'use strict';

  var ID = ${jsJson(id)};
  var DEFAULTS = ${jsJson(cfg)};
  var GROUPS = { sector: 1, symbol: 1 };
  var SORTS = { weight: 1, symbol: 1, gain: 1 };

  /** A numeric attribute, or null when the row does not carry one. */
  function attrNum(el, name) {
    var v = el.getAttribute(name);
    if (v === null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function ixOf(tr) { return Number(tr.getAttribute('data-ix')) || 0; }

  /**
   * Compare two rows under one order, always falling back to the given order.
   *
   * Weight order is value order: every weight in a variant shares one denominator, so sorting on
   * the cents avoids re-reading a formatted percentage back out of the DOM. Rows with no value
   * and rows with no gain sort last in their respective orders rather than sorting as zero, which
   * would file an unknown between a loss and a profit.
   */
  function cmp(mode, a, b) {
    var d = 0, x, y, p, q;
    if (mode === 'symbol') {
      x = a.getAttribute('data-sym') || '';
      y = b.getAttribute('data-sym') || '';
      d = x < y ? -1 : x > y ? 1 : 0;
    } else {
      p = attrNum(a, mode === 'gain' ? 'data-g' : 'data-v');
      q = attrNum(b, mode === 'gain' ? 'data-g' : 'data-v');
      if (p === null && q === null) d = 0;
      else if (p === null) d = 1;
      else if (q === null) d = -1;
      else d = q - p;
    }
    return d !== 0 ? d : ixOf(a) - ixOf(b);
  }

  CK.build(ID, function (sec) {

    var body = sec.querySelector('.ck-pf-body');
    var rows = [];
    if (body) {
      var found = body.querySelectorAll('tr.ck-pf-row');
      for (var i = 0; i < found.length; i++) rows.push(found[i]);
    }

    var cash = sec.querySelector('tr.ck-pf-cash');

    /* Collected once. Every cell that changes with the cash sleeve carries both texts, so the
       swap is a copy out of an attribute and never a calculation. */
    var swaps = [];
    var marked = sec.querySelectorAll('[data-w0], [data-v0]');
    for (var j = 0; j < marked.length; j++) swaps.push(marked[j]);

    /** Reorder in place. appendChild moves a node it already owns, so this is a permutation. */
    function order(mode) {
      if (!body || rows.length < 2) return;
      var arr = rows.slice();
      arr.sort(function (a, b) { return cmp(mode, a, b); });
      for (var i = 0; i < arr.length; i++) body.appendChild(arr[i]);
    }

    /** Copy the variant's text into every dual-valued cell, with textContent and never markup. */
    function swap(on) {
      for (var i = 0; i < swaps.length; i++) {
        var el = swaps[i];
        var v = on ? (el.getAttribute('data-w1') || el.getAttribute('data-v1'))
                   : (el.getAttribute('data-w0') || el.getAttribute('data-v0'));
        if (v !== null) el.textContent = v;
      }
    }

    function apply(cfg) {
      var group = GROUPS[cfg.group] ? cfg.group : 'sector';
      var mode = SORTS[cfg.sort] ? cfg.sort : 'weight';
      var on = !!cfg.showCash;

      sec.dataset.group = group;
      sec.dataset.cash = on ? 'on' : 'off';
      sec.dataset.sort = mode;

      if (cash) cash.hidden = !on;
      swap(on);
      order(mode);
    }

    CK.settings(sec, DEFAULTS, apply);
  });
})();`;
}

/**
 * Build one portfolio card.
 *
 * @param id    unique on the desk; becomes `data-card` and the settings storage key
 * @param title the card's heading, rendered as plain text
 * @param data  `{ holdings, cash, currency }`; every value in it is untrusted and escaped. An
 *              optional `data.settings` seeds the panel, so a descriptor can ship a card already
 *              grouped by symbol without the viewer having to ask for it
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup, scoped CSS, a classic script
 *
 * @example
 * const card = build({ id: 'book', title: 'Book', ord: 1, data: {
 *   holdings: [{ symbol: 'AAPL', qty: 10, cost: 150, last: 231.4, sector: 'tech' }],
 *   cash: 2500, currency: 'USD'
 * } });
 * card.html.indexOf('data-card="book"') > 0;   // true
 *
 * @see meta
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'portfolio' : id);
  const heading = String(title == null ? 'Portfolio' : title);
  const d = data && typeof data === 'object' ? data : {};
  const cfg = settle(d.settings);

  const raw = Array.isArray(d.holdings) ? d.holdings : [];
  const held = raw.map(model);

  /* A missing cash figure is zero cash, not a missing feature: the sleeve stays in the table and
     in the panel so the control always does something visible, and adding zero changes no total. */
  const cashMinor = minor(num(d.cash) === null ? 0 : d.cash, MONEY_DP) || 0;

  const rows = held.concat([cashRowModel(cashMinor, held.length)]);

  /* One decimal width for the whole quantity column, decided by whether any position is
     fractional. Per-row widths would ragged the column, which is the one thing a quantity column
     is for. */
  const fractional = held.some((h) => !Number.isInteger(h.qty));
  const qtyDp = fractional ? 4 : 0;

  const t = totals(held, cashMinor);
  const wOn = weights(rows, true, t.valueOn);
  const wOff = weights(rows, false, t.valueOff);

  const donuts = [];
  const legends = [];
  for (const g of GROUPS) {
    for (const c of ['on', 'off']) {
      const withCash = c === 'on';
      const groups = groupsFor(rows, g, withCash);
      const mag = groups.reduce((a, b) => a + b.mag, 0);
      const tenths = mag > 0 ? apportion(groups.map((x) => x.mag), mag, TENTHS) : null;
      const total = withCash ? t.valueOn : t.valueOff;
      const centre = CK.fmt(fromMinor(total, MONEY_DP));
      const key = g + '-' + c;
      donuts.push(donut(groups, tenths, 'allocation by ' + g + (withCash ? ', cash included' : ''), centre, key));
      legends.push(legend(groups, tenths, key));
    }
  }

  const view = {
    rows, qtyDp, wOn, wOff, donuts, legends, cashMinor,
    totals: t,
    holdings: held.length,
    incomplete: held.filter((h) => h.incomplete).length,
    currency: d.currency == null ? '' : String(d.currency).trim(),
    empty: held.length === 0 && cashMinor === 0,
  };

  return {
    json: {
      id: cardId, type: meta.name, title: heading,
      ord: ord == null ? null : ord,
      settings: cfg,
      holdings: held.length,
      totals: {
        basis: fromMinor(t.basis, MONEY_DP),
        value: fromMinor(t.valueOn, MONEY_DP),
        gain: fromMinor(t.gain, MONEY_DP),
      },
    },
    html: markup(cardId, heading, cfg, view),
    css: styles(),
    js: script(cardId, cfg),
  };
}

export default { meta, defaults, build };
