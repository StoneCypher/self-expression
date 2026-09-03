/**
 * `risk` -- a risk register placed on a probability-by-impact grid, with the arithmetic refused.
 *
 * **The cells are not a multiplication, and this card is built so that nothing on it can be
 * mistaken for one.** No product is computed anywhere in this file. The reason is worth stating
 * at length, because the multiplication is the default that every risk template ships with:
 *
 *   - Probability and impact are **ordinal** scales. "Moderate" is the third label on a list, not
 *     three of anything. Multiplying two labels produces a number with no unit, and the number
 *     changes if you renumber the same labels 0-4 or 1-5 or 2-4-8-16-32 -- which is a definition
 *     of a meaningless quantity.
 *   - Multiplication **averages away the tail**. A catastrophic risk at the lowest probability
 *     scores 5, and a trivial one at the highest scores 5, and a register that sorts by that
 *     number puts the thing that could end the company level with the thing that wastes an
 *     afternoon. The register exists to find the first kind. A score that hides it is worse than
 *     no score, because it hides it while looking like diligence.
 *
 * So this card offers ordering, never scoring, and says in the caption exactly what the ordering
 * does and does not mean. The default order is **lexicographic on impact then probability**: it
 * is a total order, it is reproducible, and no quantity of low probability can move a severe risk
 * below a moderate one. That is precisely the property multiplication gives away.
 *
 * The top of the impact scale is drawn as a band with its own rule and its own list, above and
 * apart from the grid, so a catastrophic-but-unlikely risk is findable by looking at one place
 * rather than by scanning for a pale square in a corner. Two things were considered and rejected:
 * shading cells by severity alone (colour carrying the whole meaning, and unreadable to a reader
 * who sees none of it) and sorting by any composite (see above).
 *
 * Two facts the grid cannot hold are carried as text on every risk, because both are the sort of
 * thing a register is actually for: the **response** -- accept, mitigate, transfer or avoid --
 * and whether anyone **owns** it. A risk with no owner is a risk nobody is watching, and the card
 * counts those separately and says so in those words.
 *
 * The whole register is rendered here, in Node, escaped. The browser half reorders and hides
 * elements that already exist; it never builds one.
 *
 * @see ./raci.mjs     -- the sibling written alongside this one
 * @see ./matrix.mjs   -- a grid whose axes are permutable, which these deliberately are not
 * @see ../CONTRACT.md -- `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so the build-time escape is the same function
 * the browser would have used rather than a second copy of it that drifts.
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
  catch (e) { throw new Error('cardkit/risk: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/risk: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Declared before {@link meta} and spread into it, so there is one written source and two places
 * to read it.
 *
 * `order` is the only setting that could be dangerous, and it is deliberately not a score: its
 * three values are three lexicographic orders and the card says which one is in force and what it
 * costs. There is no fourth value computing anything.
 *
 * @example defaults.order;   // 'impact'
 */
export const defaults = {
  order: 'impact',
  grid:  true,
  dense: false,
};

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * `work-and-lists` -- "what is outstanding, and what can I do about it" is exactly the question a
 * risk register answers, and the response column is literally the second half of it.
 * `correlation-and-multivariate` was considered and rejected: probability and impact are not two
 * measurements of one thing that might move together, they are two independent classifications,
 * and filing this under correlation would suggest the card is looking for a relationship between
 * them. It is not. That suggestion is how the multiplication gets invented in the first place.
 *
 * @example meta.name;   // 'risk'
 */
export const meta = {
  name: 'risk',
  summary:
    'A risk register on a probability-by-impact grid that refuses to multiply the two, keeps the ' +
    'worst-impact band prominent whatever its probability, and counts the risks nobody owns.',
  shape:
    '{ risks: [{ id, label, probability, impact, response, owner, note }], ' +
    'scale: { probability: [label], impact: [label] } } -- ' +
    'probability and impact are an integer level from 1 up, or one of the scale labels; ' +
    'response is accept | mitigate | transfer | avoid; a missing level leaves the risk unplaced ' +
    'and an out-of-scale one is refused and named',
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
 * the scanner desynchronises on the quote inside a `replace` call and starts blanking real code,
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
 * written in this file; it is reached for as `String.fromCharCode(96)`, which cannot be mistyped
 * and cannot be mis-decoded during emission.
 *
 * @param src the emitted script
 * @param who a label for the message, conventionally the module's name
 * @returns `src` unchanged, so the call can wrap the value it is checking
 * @throws {Error} naming the offending construct, its offset and the text around it
 *
 * @example guardEmitted('var a = 1;');   // returns it unchanged
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/risk';
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

/* -- the vocabulary ----------------------------------------------------------------------- */

/**
 * The default probability scale, lowest first.
 *
 * Five levels because five is what every register in the wild uses, and the labels are words
 * rather than numbers because that is the whole point: a level is a name, and naming it with a
 * digit is the first step towards someone multiplying it.
 */
const PROB_SCALE = ['rare', 'unlikely', 'possible', 'likely', 'almost certain'];

/** The default impact scale, lowest first. */
const IMPACT_SCALE = ['negligible', 'minor', 'moderate', 'major', 'severe'];

/** The most levels an axis may have. Past this the grid stops fitting a desk column. */
const MAX_LEVELS = 9;

/** The four responses, in the order they escalate. Anything else is kept, flagged and counted. */
const RESPONSES = ['accept', 'mitigate', 'transfer', 'avoid'];

/** Risk labels are clipped to this in the register; the full text survives in `title`. */
const LABEL_CHARS = 88;

/** Risk labels are clipped much harder inside a grid cell, where there are five to a row. */
const CELL_CHARS = 20;

/** How many risk labels one grid cell prints before it stops naming and starts counting. */
const CELL_NAMES = 2;

/** How many names a caption lists before it stops naming and starts counting. */
const NAME_CAP = 4;

/* -- reading the data --------------------------------------------------------------------- */

/**
 * Drop C0 control characters and DEL from a caller's text, keeping nothing invisible.
 *
 * Code-point arithmetic rather than a character class, per contract rule 6: a class has to be
 * spelled with escapes, and an escape decoded one step too early puts a raw control character
 * into this file where it is invisible in every editor and survives `node --check`. DEL goes too,
 * because `JSON.stringify` does not escape it and it would travel intact into an attribute.
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
 * A clipped string finished as a sentence: a full stop and a space, unless the clip already ended
 * it with an ellipsis.
 *
 * Both halves matter. The trailing space is what keeps the flattened text from fusing this element
 * to the next, and the suppressed full stop is what keeps a clipped label from reading
 * "vendor fails its au...." with four dots, which looks like a bug in the clipper.
 *
 * @example sentence('short', 40);      // 'short. '
 * @example sentence('a very long\u2026', 5); // 'a ve\u2026 '
 */
function sentence(s, max) {
  const t = clip(s, max);
  return t + (t.endsWith('\u2026') ? ' ' : '. ');
}

/**
 * One axis's labels, from the caller's `scale` or from the default.
 *
 * A scale of one level is legal and draws a one-row or one-column grid, which is a truthful
 * picture of a register whose author decided there is only one kind of impact. A scale of zero
 * falls back to the default rather than producing a grid with no axis.
 *
 * @param given    the caller's list, possibly absent or full of junk
 * @param fallback the default scale for this axis
 * @returns cleaned labels, lowest level first, capped at {@link MAX_LEVELS}
 *
 * @example normScale(['low', 'high'], PROB_SCALE);   // ['low', 'high']
 * @example normScale(undefined, PROB_SCALE).length;  // 5
 */
function normScale(given, fallback) {
  const arr = Array.isArray(given) ? given : [];
  const out = [];
  for (const v of arr) {
    if (v == null) continue;
    const s = clean(v).trim();
    if (s === '') continue;
    out.push(clip(s, 32));
    if (out.length >= MAX_LEVELS) break;
  }
  return out.length ? out : fallback.slice();
}

/**
 * A level on one axis: an integer from 1, a scale label, or nothing.
 *
 * The three answers are three different facts and are kept apart, because collapsing them is how
 * a register loses information it was built to hold:
 *
 *   - `{ level: n }` -- a real level.
 *   - `{ level: 0, missing: true }` -- nobody stated one. The risk is unplaced and is listed
 *     under the grid rather than dropped, because "we have not assessed this" is itself a finding.
 *   - `{ level: 0, bad: 'catastrophic' }` -- somebody stated one this scale does not have. Refused
 *     rather than clamped: clamping a 7 to a 5 on a five-point scale silently rewrites the
 *     assessment, and the caller would never learn their scale and their data disagree.
 *
 * @param v     the caller's value
 * @param scale the axis labels, lowest first
 * @returns `{ level, missing, bad }`
 *
 * @example readLevel(3, IMPACT_SCALE).level;         // 3
 * @example readLevel('Severe', IMPACT_SCALE).level;  // 5
 * @example readLevel(9, IMPACT_SCALE).bad;           // '9'
 */
function readLevel(v, scale) {
  if (v == null) return { level: 0, missing: true, bad: '' };
  const s = clean(v).trim();
  if (s === '') return { level: 0, missing: true, bad: '' };

  const lower = s.toLowerCase();
  for (let i = 0; i < scale.length; i++) {
    if (scale[i].toLowerCase() === lower) return { level: i + 1, missing: false, bad: '' };
  }

  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= scale.length) {
    return { level: n, missing: false, bad: '' };
  }
  return { level: 0, missing: false, bad: clip(s, 24) };
}

/**
 * One risk, with every field vetted and nothing coerced into a value nobody supplied.
 *
 * @param raw   the caller's risk, entirely untrusted
 * @param P     the probability scale
 * @param I     the impact scale
 * @param index the risk's position in the register, which is the tiebreak in every ordering
 *
 * @example readOne({ label: 'x', impact: 5, probability: 1 }, PROB_SCALE, IMPACT_SCALE, 0).impact;   // 5
 */
function readOne(raw, P, I, index) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const prob = readLevel(r.probability, P);
  const imp = readLevel(r.impact, I);

  const respRaw = r.response == null ? '' : clean(r.response).trim();
  const respLower = respRaw.toLowerCase();
  const known = RESPONSES.indexOf(respLower) >= 0;

  const owner = r.owner == null ? '' : clean(r.owner).trim();

  return {
    index,
    id: r.id == null ? '' : clean(r.id),
    label: r.label == null ? '' : clean(r.label),
    note: r.note == null ? '' : clean(r.note),
    probability: prob.level,
    probMissing: prob.missing,
    probBad: prob.bad,
    impact: imp.level,
    impactMissing: imp.missing,
    impactBad: imp.bad,
    response: known ? respLower : respRaw,
    responseKnown: known,
    responseGiven: respRaw !== '',
    owner,
    hasOwner: owner !== '',
  };
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * A duplicate id keeps the first and counts the rest. Unlike a duplicate matrix cell this is not
 * merely cosmetic: the ordering falls back to the register position, and two risks answering to
 * one id would make any external action on "risk R-4" ambiguous.
 *
 * A risk with no label at all still renders, under its id or under a positional name. Failing to
 * name itself does not make a risk less real, and dropping it would remove the row that says
 * somebody typed something here.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the refusal counts
 *
 * @example readData({ risks: [{ impact: 5, probability: 1 }] }).placed.length;   // 1
 */
function readData(data) {
  const isArr = Array.isArray(data);
  const d = !isArr && data && typeof data === 'object' ? data : {};
  const scaleSpec = d.scale && typeof d.scale === 'object' ? d.scale : {};

  const P = normScale(scaleSpec.probability, PROB_SCALE);
  const I = normScale(scaleSpec.impact, IMPACT_SCALE);

  const src = isArr ? data : Array.isArray(d.risks) ? d.risks : [];
  const seen = new Set();
  const risks = [];
  const drop = { dupe: 0, badProb: 0, badImpact: 0, badResponse: 0 };
  const strayProb = [];
  const strayImpact = [];
  const strayResponse = [];
  let auto = 0;

  for (const raw of src) {
    const r = readOne(raw, P, I, risks.length);
    let id = r.id;
    if (id === '') { do { id = 'risk' + (++auto); } while (seen.has(id)); }
    if (seen.has(id)) { drop.dupe++; continue; }
    seen.add(id);
    r.id = id;
    if (r.label === '') r.label = id;

    if (r.probBad) { drop.badProb++; if (strayProb.indexOf(r.probBad) < 0) strayProb.push(r.probBad); }
    if (r.impactBad) { drop.badImpact++; if (strayImpact.indexOf(r.impactBad) < 0) strayImpact.push(r.impactBad); }
    if (r.responseGiven && !r.responseKnown) {
      drop.badResponse++;
      if (strayResponse.indexOf(r.response) < 0) strayResponse.push(r.response);
    }

    r.index = risks.length;
    risks.push(r);
  }

  const placed = risks.filter((r) => r.probability > 0 && r.impact > 0);
  const unplaced = risks.filter((r) => !(r.probability > 0 && r.impact > 0));

  return { P, I, risks, placed, unplaced, drop, strayProb, strayImpact, strayResponse };
}

/* -- what the register says about itself -------------------------------------------------- */

/**
 * The counts, the tail, and every other thing the caption is going to claim.
 *
 * No product appears here and none appears anywhere downstream. The closest this file comes to
 * combining the two axes is a lexicographic comparison, which is an ordering and not a quantity:
 * it never adds, never multiplies, and never lets one axis compensate for the other.
 *
 * @param R the output of {@link readData}
 * @returns the census, the tail level and its members, the owner and response tallies, and the
 *          two degenerate observations worth making out loud
 *
 * @example survey(readData({ risks: [{ impact: 5, probability: 1 }] })).tailLevel;   // 5
 */
function survey(R) {
  const counts = new Map();
  for (const r of R.placed) {
    const key = r.impact + '|' + r.probability;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let tailLevel = 0;
  for (const r of R.placed) if (r.impact > tailLevel) tailLevel = r.impact;
  const tail = R.placed.filter((r) => r.impact === tailLevel);

  const unowned = R.risks.filter((r) => !r.hasOwner);

  const responses = { accept: 0, mitigate: 0, transfer: 0, avoid: 0 };
  let noResponse = 0;
  let otherResponse = 0;
  for (const r of R.risks) {
    if (r.responseKnown) responses[r.response]++;
    else if (r.responseGiven) otherResponse++;
    else noResponse++;
  }

  return {
    counts,
    tailLevel,
    tail,
    topOfScale: R.I.length,
    unowned,
    responses,
    noResponse,
    otherResponse,
    total: R.risks.length,
    placedCount: R.placed.length,
    /* One occupied cell means the grid is drawing a single square and telling the reader nothing
       the list does not already say. Worth admitting rather than letting the picture imply
       structure it does not have. */
    oneCell: counts.size === 1 && R.placed.length > 1,
    noProbability: R.risks.filter((r) => r.probMissing).length,
    noImpact: R.risks.filter((r) => r.impactMissing).length,
  };
}

/* -- saying it ---------------------------------------------------------------------------- */

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * A comma-joined list of at most {@link NAME_CAP} risk labels, with the remainder counted.
 *
 * @example names([{ label: 'a' }, { label: 'b' }]);   // 'a, b'
 */
function names(items) {
  const shown = items.slice(0, NAME_CAP).map((x) => clip(x.label, 34));
  const rest = items.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ', and ' + rest + ' more' : '');
}

/**
 * The sentence that explains what an ordering is, for each of the three orderings.
 *
 * Shipped to the browser as data and set with `textContent` when the viewer changes the setting,
 * because the sentence is the entire defence of the ordering and an ordering whose defence has
 * gone stale is worse than one with no defence at all.
 *
 * @example ORDER_NOTE.impact.indexOf('not a score') > 0;   // true
 */
const ORDER_NOTE = {
  impact:
    'Ordered by impact first, with probability only as a tiebreak. That is a lexicographic ' +
    'order, not a score: no amount of low probability can move a severe risk below a moderate ' +
    'one, which is exactly what multiplying the two would do.',
  probability:
    'Ordered by probability first, with impact only as a tiebreak. The worst-impact risks are no ' +
    'longer at the top of this list; they are still in the band above it, which is why that band ' +
    'is drawn separately.',
  given:
    'In the order the register was written, which is nothing more than that: it is not a ranking ' +
    'and the card is not claiming it is one.',
};

/**
 * The sentences the caption prints, in the order a reader wants them.
 *
 * Every sentence ends in a full stop and every emitted element carries its own trailing space,
 * because the caption is flattened by a screen reader and by copy-paste and a clause with no
 * terminal punctuation runs into the next one.
 *
 * @param R the output of {@link readData}
 * @param S the output of {@link survey}
 * @returns `{ head, refusal, findings }` -- all plain text, escaped by the caller
 *
 * @example verdict(readData({}), survey(readData({}))).head;   // 'No risks on this register.'
 */
function verdict(R, S) {
  const findings = [];

  const head = !S.total
    ? 'No risks on this register.'
    : 'The scale is ' + plural(R.P.length, 'probability level', 'probability levels') + ' by ' +
      plural(R.I.length, 'impact level', 'impact levels') + '.';

  const refusal =
    'The cells are not a multiplication. Probability and impact are ordinal labels, so their ' +
    'product carries no unit, and it ranks a catastrophe nobody expects level with a nuisance ' +
    'everybody does. Nothing on this card multiplies them.';

  if (S.tailLevel) {
    const band = R.I[S.tailLevel - 1];
    findings.push(
      plural(S.tail.length, 'risk sits', 'risks sit') + ' at ' + band + ', the worst impact ' +
      'recorded here, whatever its probability: ' + names(S.tail) + '.');
    if (S.tailLevel < S.topOfScale) {
      findings.push(
        'Nothing is recorded above ' + band + ', though the scale runs to ' +
        R.I[S.topOfScale - 1] + '.');
    }
  }

  if (S.oneCell) {
    findings.push(
      'Every placed risk is in one cell, so the grid is a single square and is telling you ' +
      'nothing the list below it does not.');
  }

  if (S.unowned.length) {
    findings.push(
      plural(S.unowned.length, 'risk has', 'risks have') + ' no owner, which is ' +
      plural(S.unowned.length, 'risk', 'risks') + ' nobody is watching: ' + names(S.unowned) + '.');
  } else if (S.total) {
    findings.push('Every risk has an owner.');
  }

  if (S.total) {
    /* The four buckets, the silent ones, AND the ones that said something else. All five have to
       be here or the tally does not add up to the register, and a tally that quietly loses a row
       is worse than no tally: it looks complete. */
    const parts = RESPONSES
      .filter((k) => S.responses[k] > 0)
      .map((k) => S.responses[k] + ' ' + k);
    if (S.otherResponse) parts.push(S.otherResponse + ' outside that vocabulary');
    if (S.noResponse) parts.push(S.noResponse + ' with no response stated');
    findings.push('Responses: ' + (parts.length ? parts.join(', ') : 'none stated at all') +
                  ', which is ' + S.total + ' in all.');
  }

  if (R.unplaced.length) {
    const why = [];
    if (S.noProbability) why.push(plural(S.noProbability, 'has', 'have') + ' no probability');
    if (S.noImpact) why.push(plural(S.noImpact, 'has', 'have') + ' no impact');
    findings.push(
      plural(R.unplaced.length, 'risk cannot', 'risks cannot') + ' be placed on the grid' +
      (why.length ? ' (' + why.join(', ') + ')' : '') +
      '; they are listed under it rather than dropped, because an unassessed risk is a finding.');
  }

  return { head, refusal, findings };
}

/**
 * The one sentence a screen reader gets for the grid table.
 *
 * @example ariaFor(readData({}), survey(readData({})));   // 'Probability by impact grid. …'
 */
function ariaFor(R, S) {
  const v = verdict(R, S);
  return ('Impact by probability grid. ' + v.head + ' ' + v.refusal + ' ' + v.findings.join(' '))
    .replace(/\s+/g, ' ').trim();
}

/* -- emit --------------------------------------------------------------------------------- */

/** The card's id as it may appear inside a double-quoted CSS attribute selector. */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/**
 * A JavaScript literal safe to paste into an inline `<script>`.
 *
 * `<` and `>` become escapes so a value containing a closing script tag cannot end the block
 * early, with the side effect that no value can spell an arrow. The QUESTION MARK is escaped
 * because a caller string containing `?.` is optional chaining as far as a raw scan is concerned,
 * so the card's own guard would refuse the build over a rule the card did not break. Two agents
 * on this catalogue hit exactly that.
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
  const own = '.ck-risk[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet, including the one place a literal colour is allowed.
 *
 * Five band tokens, one hue at five lightnesses, defined on bare `:root` and overridden under
 * `:root[data-theme="light"]` -- exactly the escape hatch `CONTRACT.md` describes. They cannot
 * come from `--ck-s1..s8`, which are eight separated HUES chosen so no series reads as louder
 * than another; an impact scale is ORDERED and needs an ordered channel, and lightness is the
 * only ordered channel available. The ramp is monotonic in both themes, so the ordering survives
 * the light switch.
 *
 * The band colour is on the ROW HEADER and not on the cells. That is the important restraint:
 * washing a whole row would say "there are severe risks here" about a row that may be empty, and
 * it would make colour the primary encoding of severity. On the header it decorates a label that
 * already says the word, beside a row whose position already carries the order.
 */
function cardCss(id) {
  const tokens =
    ':root {\n' +
    '  --ck-rk-1: oklch(0.30 0.020 40);\n' +
    '  --ck-rk-2: oklch(0.36 0.038 40);\n' +
    '  --ck-rk-3: oklch(0.43 0.058 38);\n' +
    '  --ck-rk-4: oklch(0.50 0.080 34);\n' +
    '  --ck-rk-5: oklch(0.58 0.105 30);\n' +
    '}\n' +
    ':root[data-theme="light"] {\n' +
    '  --ck-rk-1: oklch(0.95 0.010 40);\n' +
    '  --ck-rk-2: oklch(0.91 0.026 40);\n' +
    '  --ck-rk-3: oklch(0.86 0.046 38);\n' +
    '  --ck-rk-4: oklch(0.81 0.068 34);\n' +
    '  --ck-rk-5: oklch(0.76 0.092 30);\n' +
    '}\n';

  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-rk-gridwrap', 'margin-top: 10px;'],
    ['.ck-rk-gridwrap[hidden]', 'display: none;'],
    ['table.ck-rk-grid', 'width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px;'],

    ['.ck-rk-grid th',
     'font-weight: 400; text-align: left; font-family: var(--mono); font-size: 10px; ' +
     'color: var(--ink-dim); padding: 4px 6px; vertical-align: middle;'],
    ['.ck-rk-grid thead th',
     'border-bottom: 1px solid var(--rule); color: var(--ink-faint); text-align: center;'],
    ['.ck-rk-grid thead th.ck-rk-corner', 'text-align: left;'],
    ['.ck-rk-grid td',
     'border: 1px solid var(--hairline); padding: 4px 5px; vertical-align: top; ' +
     'width: 16%; background: var(--well);'],
    ['.ck-rk-grid td.ck-rk-on', 'background: var(--pill);'],

    /* The band token lands on the row header only. See the note above cardCss. */
    ['.ck-rk-grid th.ck-rk-band', 'color: var(--ink); border-left: 3px solid var(--rule);'],
  ];

  for (let i = 1; i <= 5; i++) {
    rules.push(['.ck-rk-grid th.ck-rk-b' + i, 'border-left-color: var(--ck-rk-' + i + ');']);
  }

  rules.push(
    /* The tail band. A rule above and below it and a heavier label, so the worst-impact row is
       findable by looking rather than by scanning -- which is the entire reason it is here. */
    ['.ck-rk-grid tr.ck-rk-tail th, .ck-rk-grid tr.ck-rk-tail td',
     'border-top: 2px solid var(--accent);'],
    ['.ck-rk-grid tr.ck-rk-tail th', 'color: var(--accent);'],

    ['.ck-rk-n', 'font: 700 13px/1.1 var(--mono); color: var(--ink); display: block;'],
    ['.ck-rk-mini', 'display: block; color: var(--ink-faint); font-size: 9.5px; line-height: 1.35; margin-top: 2px;'],

    ['.ck-rk-h3', 'margin: 16px 0 6px;'],

    ['ul.ck-rk-list, ul.ck-rk-loose',
     'list-style: none; margin: 6px 0 0; padding: 0;'],
    ['.ck-rk-item',
     'padding: 6px 4px; border-bottom: 1px solid var(--hairline); font-size: 12px;'],
    ['.ck-risk.ck-rk-dense .ck-rk-item', 'padding: 2px 4px;'],
    ['.ck-rk-item[hidden]', 'display: none;'],
    ['.ck-rk-lab', 'color: var(--ink); display: inline;'],
    ['.ck-rk-meta',
     'display: block; font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;'],
    ['.ck-risk.ck-rk-dense .ck-rk-note', 'display: none;'],
    ['.ck-rk-note', 'display: block; font-size: 11px; color: var(--ink-faint); margin-top: 1px;'],
    ['.ck-rk-unowned', 'color: var(--ck-s1);'],
    ['.ck-rk-oddresp', 'color: var(--ck-s2);'],

    ['.ck-rk-tailmark',
     'display: inline-block; font: 700 9px/1.5 var(--mono); letter-spacing: .06em; ' +
     'color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; ' +
     'padding: 0 4px; margin-right: 6px; vertical-align: 1px;'],

    ['.ck-rk-order', 'display: block; margin: 0 0 4px;'],
    ['.ck-rk-refuse', 'display: block; margin: 0 0 4px; color: var(--ink-dim);'],
    ['.ck-rk-find', 'display: block; margin: 0 0 4px;'],
    ['.ck-rk-void', 'font-family: var(--mono); font-size: 11px; color: var(--ink-faint); padding: 12px 0 4px;'],

    /* Off screen but still in the accessibility tree: the table caption is the one place the
       whole argument for the layout is stated to a reader who cannot see the layout. */
    ['.ck-rk-sr',
     'position: absolute; width: 1px; height: 1px; overflow: hidden; ' +
     'clip-path: inset(50%); white-space: nowrap;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  );

  return tokens + scope(id, rules) + '\n';
}

/**
 * The impact band a level falls in, from 1 to 5, whatever the scale's own length.
 *
 * A three-level scale and a nine-level scale both have to map onto five tokens, and the mapping
 * has to keep the top level in the top band or the tail loses its colour. Ceiling division does
 * both: level `n` of `N` lands in `ceil(n / N * 5)`, so level N always lands in band 5.
 *
 * @example bandOf(5, 5);   // 5
 * @example bandOf(1, 9);   // 1
 */
function bandOf(level, levels) {
  if (!(levels > 0) || !(level > 0)) return 1;
  const b = Math.ceil((level / levels) * 5);
  return Math.max(1, Math.min(5, b));
}

/**
 * The grid: impact down with the worst at the top, probability across with the rarest at the left.
 *
 * Impact is on the vertical axis and reversed on purpose. Reading order puts the top-left first,
 * and the thing a register is for is the worst outcome -- so the worst impact is the first row
 * and it keeps that place whatever its probability. Sorting the grid any other way would put the
 * tail wherever the arithmetic happened to leave it, which is the failure this card exists to
 * avoid.
 */
function gridHtml(R, S) {
  const e = CK.esc;
  const nP = R.P.length;
  const nI = R.I.length;

  /* Every cell's text ends with a space. Table cells flatten straight into one another, so
     without it a header row reads "impact \\ probabilityrareunlikelypossible". */
  const head =
    '<tr><th scope="col" class="ck-rk-corner">impact \\ probability </th>' +
    R.P.map((p) => '<th scope="col">' + e(p) + ' </th>').join('') + '</tr>';

  const rows = [];
  for (let i = nI; i >= 1; i--) {
    const band = bandOf(i, nI);
    const isTail = i === S.tailLevel;
    const cells = [];
    for (let p = 1; p <= nP; p++) {
      const here = R.placed.filter((r) => r.impact === i && r.probability === p);
      if (!here.length) { cells.push('<td></td>'); continue; }
      const shown = here.slice(0, CELL_NAMES).map((r) => sentence(r.label, CELL_CHARS)).join('');
      const rest = here.length - Math.min(CELL_NAMES, here.length);
      cells.push(
        '<td class="ck-rk-on" title="' + e(here.map((r) => r.label).join('; ')) + '">' +
        '<b class="ck-rk-n">' + here.length + ' </b>' +
        '<span class="ck-rk-mini">' + e(shown) + (rest > 0 ? e('and ' + rest + ' more. ') : '') +
        '</span></td>');
    }
    rows.push(
      '<tr' + (isTail ? ' class="ck-rk-tail"' : '') + '>' +
      '<th scope="row" class="ck-rk-band ck-rk-b' + band + '">' +
      (isTail ? '<span class="ck-rk-tailmark">TAIL </span>' : '') + e(R.I[i - 1]) + ' </th>' +
      cells.join('') + '</tr>');
  }

  return '<table class="ck-rk-grid">\n' +
    '        <caption class="ck-rk-sr">' + e(ariaFor(R, S)) + '</caption>\n' +
    '        <thead>' + head + '</thead>\n' +
    '        <tbody>' + rows.join('') + '</tbody>\n' +
    '      </table>';
}

/**
 * One register entry.
 *
 * A `<ul>` with no markers rather than an `<ol>`, and that is a decision rather than a style: a
 * numbered list reads as a ranking, a ranking reads as a score, and a score is the one thing this
 * card refuses to imply. The sort keys ride in `data-` attributes so the browser can reorder
 * without ever seeing the risk's contents.
 */
function itemHtml(r, R, S) {
  const e = CK.esc;
  const bits = [];

  bits.push(r.impact > 0 ? R.I[r.impact - 1] + ' impact' : 'impact not stated');
  bits.push(r.probability > 0 ? R.P[r.probability - 1] + ' probability' : 'probability not stated');
  bits.push(r.responseKnown ? r.response
    : r.responseGiven ? 'response "' + r.response + '", which is not one of ' + RESPONSES.join(', ')
    : 'no response stated');

  const owner = r.hasOwner
    ? 'owner ' + clip(r.owner, 40) + '. '
    : 'no owner, so nobody is watching it. ';

  const isTail = r.impact > 0 && r.impact === S.tailLevel;

  /* Each span carries its own trailing space. A list item's children flatten straight into one
     another, so without it the entry reads "TAILvendor fails its auditsevere impact". */
  return '<li class="ck-rk-item" data-i="' + r.index + '" data-imp="' + r.impact +
    '" data-prob="' + r.probability + '">' +
    (isTail ? '<span class="ck-rk-tailmark">TAIL </span>' : '') +
    '<span class="ck-rk-lab" title="' + e(r.label) + '">' + e(sentence(r.label, LABEL_CHARS)) + '</span>' +
    '<span class="ck-rk-meta">' + e(bits.join('. ') + '. ') +
    '<span class="' + (r.hasOwner ? 'ck-rk-own' : 'ck-rk-unowned') + '">' + e(owner) + '</span>' +
    '</span>' +
    (r.note === '' ? '' : '<span class="ck-rk-note">' + e(clip(r.note, 200)) + '</span>') +
    '</li>';
}

/**
 * The card's markup: one section, a gear, a settings panel, the grid, the register and the caption.
 *
 * Every interpolated value goes through `CK.esc`, which drops control characters before escaping
 * the five HTML metacharacters -- so a risk label carrying a closing script tag, an `onerror`
 * attribute or a NUL comes out as text in all three cases.
 */
function cardHtml(id, title, R, S) {
  const e = CK.esc;
  const v = verdict(R, S);

  const grid = R.placed.length
    ? '  <div class="ck-rk-gridwrap">\n' +
      '    <div class="ck-scroll">\n      ' + gridHtml(R, S) + '\n    </div>\n' +
      '  </div>\n'
    : '  <div class="ck-rk-void">no risk on this register carries both a probability and an ' +
      'impact, so there is no grid to draw</div>\n';

  /* The two lists partition the register rather than overlapping it. An earlier draft printed
     every risk in the main list and then printed the unplaced ones again underneath, which put
     the same risk on the card twice with the same sort keys -- a reader counting rows would have
     got a number that is not the number of risks. */
  const list = R.placed.length
    ? '  <div class="ck-h3 ck-rk-h3">the register</div>\n' +
      '  <ul class="ck-rk-list">\n    ' +
      R.placed.map((r) => itemHtml(r, R, S)).join('\n    ') + '\n  </ul>\n'
    : '';

  const loose = R.unplaced.length
    ? '  <div class="ck-h3 ck-rk-h3">not placed on the grid</div>\n' +
      '  <ul class="ck-rk-loose">\n    ' +
      R.unplaced.map((r) => itemHtml(r, R, S)).join('\n    ') + '\n  </ul>\n'
    : '';

  const junk = [];
  if (R.drop.dupe) junk.push(plural(R.drop.dupe, 'duplicate id was', 'duplicate ids were') + ' dropped, first one kept');
  if (R.drop.badProb) {
    junk.push(plural(R.drop.badProb, 'risk names', 'risks name') + ' a probability this scale does not have (' +
              R.strayProb.slice(0, 4).join(', ') + '), refused rather than clamped');
  }
  if (R.drop.badImpact) {
    junk.push(plural(R.drop.badImpact, 'risk names', 'risks name') + ' an impact this scale does not have (' +
              R.strayImpact.slice(0, 4).join(', ') + '), refused rather than clamped');
  }
  if (R.drop.badResponse) {
    junk.push(plural(R.drop.badResponse, 'risk states', 'risks state') + ' a response outside accept, ' +
              'mitigate, transfer and avoid (' + R.strayResponse.slice(0, 4).join(', ') +
              '), kept as written and flagged');
  }

  /* Each sentence is its own block and carries its own trailing space INSIDE the element.
     `textContent` concatenates block children with nothing between them and a flex container
     drops whitespace-only nodes outright, so a separator written between two elements would
     disappear from the flattened text and fuse the last word to the first. */
  const findings = v.findings.map((s) => '<i class="ck-rk-find">' + e(s) + ' </i>').join('');

  return '<section data-card="' + e(id) + '" class="ck-risk">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-order">order the register by</label>\n' +
    '    <select id="' + e(id) + '-order" name="order">\n' +
    '      <option value="impact">impact, then probability</option>\n' +
    '      <option value="probability">probability, then impact</option>\n' +
    '      <option value="given">as written</option>\n' +
    '    </select>\n' +
    '    <label for="' + e(id) + '-grid">show the grid</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-grid" name="grid">\n' +
    '    <label for="' + e(id) + '-dense">dense rows</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-dense" name="dense">\n' +
    '    <div class="ck-set-foot">every one of these orders is lexicographic. there is no ' +
    'setting that scores a risk, because probability times impact has no unit and buries the ' +
    'rare catastrophe under the common nuisance.</div>\n' +
    '  </div>\n' +
    grid + list + loose +
    '  <div class="ck-cap">' +
    (S.total
      ? '<b>' + e(String(S.total)) + '</b> risks, ' + e(String(S.placedCount)) +
        ' placed on the grid. '
      : '') +
    e(v.head) + ' ' +
    '<i class="ck-rk-refuse">' + e(v.refusal) + ' </i>' +
    '<i class="ck-rk-order"></i>' +
    findings +
    (junk.length ? '<span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '') +
    '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: reordering the register, hiding the grid, toggling one class.
 *
 * Classic script, ES5 vocabulary, built by concatenation and passed through {@link guardEmitted}.
 *
 * The comparator is lexicographic and nothing else. It is written out longhand rather than as a
 * weighted sum precisely so that nobody later "simplifies" it into `imp * 10 + prob`, which would
 * be a score wearing an ordering's clothes -- and would start ranking a level-5 impact below a
 * level-4 the moment somebody added an eleventh probability level.
 */
function cardJs(id) {
  const src =
    '/* risk card: the grid and the register were drawn in Node. This reorders and hides. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var NOTES = ' + jsLit(ORDER_NOTE) + ';\n' +
    '  var list = sec.querySelector("ul.ck-rk-list");\n' +
    '  var gridWrap = sec.querySelector(".ck-rk-gridwrap");\n' +
    '  var orderEl = sec.querySelector(".ck-rk-order");\n' +
    '\n' +
    '  var items = [], i;\n' +
    '  if (list) {\n' +
    '    for (i = 0; i < list.children.length; i++) {\n' +
    '      items.push({ el: list.children[i] });\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  function lvl(el, name) {\n' +
    '    var v = Number(el.getAttribute(name));\n' +
    '    return isFinite(v) ? v : 0;\n' +
    '  }\n' +
    '\n' +
    '  /* The register position comes out of the MARKUP, not out of the order the elements were\n' +
    '     captured in. That distinction is the whole of a bug this card had: the builder is\n' +
    '     replayed on every desk swap, and by then the previous sort has already permuted the\n' +
    '     list -- so a capture-order index made "as written" mean "as it was left", and the order\n' +
    '     the author actually wrote could never be recovered. Reading data-i makes every ordering\n' +
    '     a pure function of the data, which is what it always claimed to be. */\n' +
    '  function src(el) { return lvl(el, "data-i"); }\n' +
    '\n' +
    '  /* Lexicographic, deliberately longhand. A level that nobody stated is 0, which sinks to\n' +
    '     the bottom of a descending order without any special case -- an unassessed risk is not\n' +
    '     a small risk, and it should not sit among the small ones. */\n' +
    '  function cmp(mode) {\n' +
    '    return function (a, b) {\n' +
    '      var r = 0;\n' +
    '      if (mode === "impact") {\n' +
    '        r = lvl(b.el, "data-imp") - lvl(a.el, "data-imp");\n' +
    '        if (r === 0) { r = lvl(b.el, "data-prob") - lvl(a.el, "data-prob"); }\n' +
    '      } else if (mode === "probability") {\n' +
    '        r = lvl(b.el, "data-prob") - lvl(a.el, "data-prob");\n' +
    '        if (r === 0) { r = lvl(b.el, "data-imp") - lvl(a.el, "data-imp"); }\n' +
    '      }\n' +
    '      /* Stability made explicit rather than borrowed from the engine. */\n' +
    '      return r !== 0 ? r : src(a.el) - src(b.el);\n' +
    '    };\n' +
    '  }\n' +
    '\n' +
    '  function apply(cfg) {\n' +
    '    var mode = Object.hasOwn(NOTES, cfg.order) ? cfg.order : "impact";\n' +
    '    var k, frag;\n' +
    '\n' +
    '    sec.classList.toggle("ck-rk-dense", !!cfg.dense);\n' +
    '    if (gridWrap) { gridWrap.hidden = !cfg.grid; }\n' +
    '\n' +
    '    /* Set, never appended. The desk swaps its main element and replays every builder, so a\n' +
    '       line that grew by one sentence per swap is the failure this comment guards against. */\n' +
    '    if (orderEl) { orderEl.textContent = NOTES[mode] + " "; }\n' +
    '\n' +
    '    if (list && items.length) {\n' +
    '      var order = items.slice(0);\n' +
    '      order.sort(cmp(mode));\n' +
    '      /* One reflow: every element is MOVED into a fragment in its new order and the\n' +
    '         fragment goes back in one call. Moving cannot duplicate, so replaying this reorders\n' +
    '         the same nodes rather than adding a second copy of the register. */\n' +
    '      frag = document.createDocumentFragment();\n' +
    '      for (k = 0; k < order.length; k++) { frag.appendChild(order[k].el); }\n' +
    '      list.appendChild(frag);\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, ' + jsLit(defaults) + ', apply);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/risk');
}

/**
 * Build one risk card.
 *
 * Every degenerate case has a decided answer rather than a crash, and every one is said out loud:
 *
 * - **no data at all** draws no grid and says no risk carries both a probability and an impact
 * - **a risk with no probability**, or **none with an impact**, is unplaced: it appears under the
 *   grid in its own list with the missing field named, and is counted in the caption
 * - **every risk in one cell** draws that one cell and the caption admits the grid is telling the
 *   reader nothing the list does not
 * - **a probability outside its scale** is refused rather than clamped, counted, and the offending
 *   value is quoted back; clamping would silently rewrite somebody's assessment
 * - **an unrecognised response** is kept exactly as written, flagged in the entry, and counted
 * - **no owner on any risk** is counted and named, in the words "nobody is watching"
 * - **duplicate ids** keep the first and count the rest
 * - **300 risks** and **a 300-character label** are clipped in the list with the cut marked and
 *   the full text kept in `title`; the grid names two per cell and counts the rest
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  see {@link meta} for the shape; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the survey's own numbers, so a test can
 *          check what the caption claims without re-deriving it
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * build({ id: 'reg', title: 'risk register', ord: 40, data: { risks: [
 *   { id: 'r1', label: 'vendor fails its audit', probability: 'unlikely', impact: 'severe',
 *     response: 'transfer', owner: 'Ana' },
 * ] } }).json.tailLevel;   // 5
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'risk' : id);
  const heading = String(title == null ? cardId : title);

  const R = readData(data);
  const S = survey(R);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      category: meta.category,
      risks: S.total,
      placed: S.placedCount,
      unplaced: R.unplaced.length,
      tailLevel: S.tailLevel,
      tail: S.tail.map((r) => r.id),
      unowned: S.unowned.length,
      responses: { ...S.responses, other: S.otherResponse, none: S.noResponse },
      oneCell: S.oneCell,
      /* Stated in the emitted record as well as in the caption, so a consumer reading `card.json`
         cannot mistake the absence of a score for an oversight. */
      scored: false,
      dropped: { ...R.drop },
    },
    html: cardHtml(cardId, heading, R, S),
    css: cardCss(cardId),
    js: cardJs(cardId),
  };
}

export default { meta, defaults, build };
