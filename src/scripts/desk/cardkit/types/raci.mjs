/**
 * `raci` -- a responsibility assignment matrix that grades itself.
 *
 * Tasks down, people across, and R / A / C / I in the cells. The grid is the cheap part. The
 * reason this type exists rather than a call to `matrix` is that a RACI grid is worthless as a
 * picture and valuable as an audit, and nothing about `matrix` can do the audit:
 *
 *   - `matrix` cells carry a WEIGHT, an ordered quantity that a barycentre sweep can average.
 *     RACI cells carry a NOMINAL category. There is no mean of {R, A, C, I}, so the seriation
 *     that is the whole argument for `matrix` has nothing to compute here.
 *   - `matrix` deliberately permutes both axes. Task order is the order of the plan and person
 *     order is the order of the team; permuting either destroys the reading. Both axes are
 *     pinned here, always, with no setting to unpin them.
 *   - The finding in `matrix` is the diagonal. The finding here is a list of RULE VIOLATIONS,
 *     which is text, not geometry.
 *
 * Strip the rule checking and this type should not exist -- it would be `matrix` with letters in
 * the squares. So the rules are the type:
 *
 *   1. **Exactly one A per row.** Two accountables is nobody accountable and zero is a task
 *      nobody owns. Both are counted and both name the tasks.
 *   2. **At least one R per row.** A task with an accountable and no responsible is a task
 *      somebody will answer for and nobody will do.
 *   3. **A person who is only ever C or I** is being consulted as ritual rather than for
 *      judgement, once they appear often enough for that to be a pattern rather than an accident.
 *   4. **A person holding most of the A column** is a bottleneck. That is a scheduling fact, and
 *      the card says it as one rather than as praise.
 *
 * **Nothing is repaired.** A row with two accountables is drawn with two accountables. Silently
 * dropping the second would hide the exact defect the matrix exists to surface, and a card that
 * quietly fixes its input teaches its reader that the input was fine.
 *
 * The whole table is rendered here, in Node, escaped, in the order it arrived. The browser half
 * only hides rows and toggles classes; it never builds a cell. There is one place where data
 * becomes markup and one escape to get right, and the card still says everything it knows if the
 * script never runs.
 *
 * @see ./matrix.mjs -- the seriated incidence matrix this is deliberately not
 * @see ./risk.mjs   -- the sibling written alongside this one
 * @see ../CONTRACT.md -- `shape` is a string, `defaults` is an object, `category` is required
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, made available to Node so the build-time escape is the same function
 * the browser would have used rather than a second copy of it that drifts.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Its top level defines only functions and one array, and nothing reaches for
 * `document` until a DOM-bound function is called -- none of which this file calls -- so a bare
 * context carrying an empty `window` is enough to run it.
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
  catch (e) { throw new Error('cardkit/raci: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/raci: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * Declared before {@link meta} and spread into it, so there is one written source and two places
 * to read it; a binding declared after `meta` could not be referenced by it at all without a
 * temporal-dead-zone error, which is how six earlier types shipped an undefined `meta.defaults`.
 *
 * There is deliberately no setting that reorders either axis. A viewer who could sort the tasks
 * by violation count would lose the order of the plan, which is the only thing that makes the
 * grid readable next to the plan it describes.
 *
 * @example defaults.only;   // 'all'
 */
export const defaults = {
  dense:  false,
  only:   'all',
  counts: true,
};

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * `work-and-lists` because the question a RACI grid answers is "what is outstanding, and what can
 * I do about it" read from the staffing side: which tasks are unowned, and who is overloaded.
 *
 * @example meta.name;   // 'raci'
 */
export const meta = {
  name: 'raci',
  summary:
    'A responsibility assignment matrix that audits itself: tasks with no accountable, tasks ' +
    'with two, tasks nobody is responsible for, people consulted as ritual, and people holding ' +
    'an implausible share of the accountability.',
  shape:
    '{ tasks: [{ id, label }], people: [{ id, label }], cells: [[taskRef, personRef, letters]] } ' +
    '-- a ref is an index or an id; letters is one or more of R, A, C and I, so a person who is ' +
    'both accountable and responsible writes "AR"; any other letter refuses the cell and is named',
  category: 'work-and-lists',
  defaults: { ...defaults },
};

/* -- the build-time guard ----------------------------------------------------------------- */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose -- one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" -- and a
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
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick -- in
 * a comment as readily as in code -- closes the surrounding template literal early and blanks
 * every card on the desk. The backtick is never written in this file; it is reached for as
 * `String.fromCharCode(96)`, which cannot be mistyped and cannot be mis-decoded during emission.
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
  const where = who || 'cardkit/raci';
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

/** The four letters, in the order the acronym names them, which is the order a cell prints. */
const LETTERS = ['R', 'A', 'C', 'I'];

/** What each letter means, for the caption and for the screen-reader text in every cell. */
const LETTER_WORD = { R: 'responsible', A: 'accountable', C: 'consulted', I: 'informed' };

/**
 * Characters a caller may use to separate letters inside one cell, and which mean nothing.
 *
 * A hand-written matrix routinely spells a doubled role as `A/R`, `A,R` or `A R`. None of those
 * is a fifth letter and refusing the cell over a slash would be pedantry that costs the reader
 * the assignment.
 */
const SEPARATORS = [' ', '/', ',', '-', '+', '&', '.'];

/**
 * How many tasks a person must appear on before "always consulted, never responsible" is called
 * ritual rather than an accident.
 *
 * One C is a person being asked about one thing. The floor is stated in the caption rather than
 * hidden here, because it is a judgement and the reader is entitled to disagree with it.
 */
const RITUAL_FLOOR = 3;

/** How many accountabilities must exist before one person holding most of them is a finding. */
const BOTTLENECK_FLOOR = 4;

/** The share of the A column above which one person is called a bottleneck. */
const BOTTLENECK_SHARE = 0.5;

/** Task labels are clipped to this many characters in the row header; the full text stays in `title`. */
const TASK_CHARS = 96;

/** Person labels are clipped to this many characters in the rotated column header. */
const PERSON_CHARS = 28;

/** How many names a caption lists before it stops naming and starts counting. */
const NAME_CAP = 4;

/* -- reading the data --------------------------------------------------------------------- */

/**
 * Drop C0 control characters and DEL from a caller's text, keeping nothing invisible.
 *
 * Written as code-point arithmetic rather than as a character class on purpose, per contract
 * rule 6. A class like that has to be spelled with escapes, and an escape decoded one step too
 * early puts the raw control character into this file, where it is invisible in every editor,
 * legal to the parser and survives `node --check`. Comparing numbers cannot go wrong that way.
 * DEL goes too: `JSON.stringify` does not escape it, so it would travel intact into an attribute.
 *
 * @param s the text to clean
 * @returns the same text with every C0 control character and DEL removed
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
 * Normalise one axis into `[{ id, label }]`, giving anonymous members an id.
 *
 * A member may arrive as an object or as a bare string; both are common when the grid is
 * generated from a query, and neither is worth making the caller box up. A duplicate id is
 * dropped rather than renamed and counted, because a cell naming that id would otherwise land on
 * whichever of the two the map happened to hold.
 *
 * @param list whatever arrived as `tasks` or `people`
 * @param kind 'task' or 'person', used to invent ids for members that lack one
 * @returns `{ list, dupes }`
 *
 * @example normAxis(['a', { id: 'b', label: 'Bee' }], 'task').list[1].label;   // 'Bee'
 */
function normAxis(list, kind) {
  const out = [];
  const seen = new Set();
  const arr = Array.isArray(list) ? list : [];
  let dupes = 0;
  let auto = 0;

  for (const raw of arr) {
    if (raw == null) continue;
    const o = raw && typeof raw === 'object' ? raw : { id: raw };
    let id = o.id == null ? '' : clean(o.id);
    if (id === '') { do { id = kind + (++auto); } while (seen.has(id)); }
    if (seen.has(id)) { dupes++; continue; }
    seen.add(id);
    out.push({ id, label: o.label == null ? id : clean(o.label) });
  }
  return { list: out, dupes };
}

/**
 * Resolve one half of a cell reference to an axis index, accepting an index or an id.
 *
 * Indices are what a generator emits and ids are what a hand-written grid uses; the cost of
 * allowing both is one map lookup. Anything resolving to neither is refused rather than coerced,
 * because a reference to person `"7"` when there are five people is a bug in the caller and
 * dropping it into person 0 would hide it.
 *
 * @returns the index, or -1 when the reference names nothing
 *
 * @example at('ana', people, byId);   // 2
 */
function at(v, list, byId) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < list.length) return v;
  const s = v == null ? '' : clean(v);
  return byId.has(s) ? byId.get(s) : -1;
}

/**
 * The letters in one cell, and any character that is not one.
 *
 * Deduped and sorted into R, A, C, I order so two cells spelling the same pair of roles render
 * identically. An unrecognised character does not silently disappear: it comes back in `bad`, the
 * cell is refused whole, and the caption names the character. A cell reading `X` is a typo or a
 * fifth role somebody invented, and both are worth being told about.
 *
 * @param v the caller's cell value
 * @returns `{ keep, bad }` -- the recognised letters in canonical order, and the rejects
 *
 * @example readLetters('a/r');   // { keep: ['R', 'A'], bad: [] }
 * @example readLetters('X');     // { keep: [], bad: ['X'] }
 */
function readLetters(v) {
  const s = clean(v).toUpperCase();
  const keep = [];
  const bad = [];
  for (const ch of s) {
    if (SEPARATORS.indexOf(ch) >= 0) continue;
    if (LETTERS.indexOf(ch) >= 0) { if (keep.indexOf(ch) < 0) keep.push(ch); }
    else if (bad.indexOf(ch) < 0) bad.push(ch);
  }
  keep.sort((a, b) => LETTERS.indexOf(a) - LETTERS.indexOf(b));
  return { keep, bad };
}

/**
 * Normalise whatever arrived into the one shape the rest of the file may assume.
 *
 * Four kinds of bad cell are counted rather than thrown on, because all four are things real data
 * does and none should cost the reader the rest of the grid:
 *
 *   - a reference to a task or person that does not exist (`badRef`);
 *   - a cell that is not a pair at all (`badRef` again);
 *   - a cell carrying a letter outside R, A, C and I (`badLetter`, with the characters kept so
 *     the caption can name them);
 *   - a duplicate `(task, person)` pair (`dupe`). The first entry wins, because a later duplicate
 *     is almost always a join artefact and the first one is what a human wrote. Merging the two
 *     would invent an assignment nobody made.
 *
 * A cell that resolves cleanly but holds no letters at all is an empty cell, not an error, and is
 * simply absent from the grid.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns everything downstream needs, including the counts above
 *
 * @example readData({ tasks: ['t'], people: ['p'], cells: [[0, 0, 'A']] }).filled;   // 1
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};

  const T = normAxis(d.tasks, 'task');
  const P = normAxis(d.people, 'person');
  const tasks = T.list;
  const people = P.list;

  const taskById = new Map();
  const personById = new Map();
  tasks.forEach((t, i) => taskById.set(t.id, i));
  people.forEach((p, i) => personById.set(p.id, i));

  const raw = Array.isArray(d.cells) ? d.cells : [];
  const grid = new Map();
  const drop = { badRef: 0, badLetter: 0, dupe: 0 };
  const strayChars = [];

  for (const entry of raw) {
    const cell = Array.isArray(entry)
      ? { task: entry[0], person: entry[1], letters: entry[2] }
      : (entry && typeof entry === 'object' ? entry : null);
    if (!cell) { drop.badRef++; continue; }

    const ti = at(cell.task, tasks, taskById);
    const pi = at(cell.person, people, personById);
    if (ti < 0 || pi < 0) { drop.badRef++; continue; }

    const got = readLetters(cell.letters);
    if (got.bad.length) {
      drop.badLetter++;
      for (const ch of got.bad) if (strayChars.indexOf(ch) < 0) strayChars.push(ch);
      continue;
    }
    if (!got.keep.length) continue;

    const key = ti + '|' + pi;
    if (grid.has(key)) { drop.dupe++; continue; }
    grid.set(key, got.keep);
  }

  return { tasks, people, grid, drop, strayChars, dupeIds: T.dupes + P.dupes };
}

/* -- the audit ---------------------------------------------------------------------------- */

/**
 * Everything the card is going to say about itself, computed once.
 *
 * Every finding here is a count first and a list of names second, and the counts are what the
 * tests assert against. Naming is capped at {@link NAME_CAP} because a caption listing forty
 * tasks stops being a caption; the count is never capped, so "and 36 more" is still a true
 * statement about a number the reader can act on.
 *
 * @param R the output of {@link readData}
 * @returns per-task rows, per-person columns, and the four rule findings
 *
 * @example audit(readData({ tasks: ['t'], people: ['p'], cells: [] })).noA.length;   // 1
 */
function audit(R) {
  const nT = R.tasks.length;
  const nP = R.people.length;

  const rows = R.tasks.map((t) => ({
    id: t.id, label: t.label, R: 0, A: 0, C: 0, I: 0, cells: 0,
  }));
  const cols = R.people.map((p) => ({
    id: p.id, label: p.label, R: 0, A: 0, C: 0, I: 0, tasks: 0,
  }));

  for (const [key, letters] of R.grid) {
    const bar = key.indexOf('|');
    const ti = Number(key.slice(0, bar));
    const pi = Number(key.slice(bar + 1));
    rows[ti].cells++;
    cols[pi].tasks++;
    for (const ch of letters) { rows[ti][ch]++; cols[pi][ch]++; }
  }

  const noA   = rows.filter((r) => r.A === 0);
  const manyA = rows.filter((r) => r.A > 1);
  const noR   = rows.filter((r) => r.R === 0);

  /* Only counted over people who appear at all. A person in no cell is a different finding with a
     different answer, and folding the two together would report an absent person as a ritual one. */
  const ritual = cols.filter((c) => c.tasks >= RITUAL_FLOOR && c.R === 0 && c.A === 0);
  const absent = cols.filter((c) => c.tasks === 0);

  const totalA = cols.reduce((a, c) => a + c.A, 0);
  const bottleneck = totalA >= BOTTLENECK_FLOOR
    ? cols.filter((c) => c.A / totalA > BOTTLENECK_SHARE)
    : [];

  return {
    nT, nP, rows, cols, noA, manyA, noR, ritual, absent, bottleneck, totalA,
    filled: R.grid.size,
    possible: nT * nP,
    /* A row is "bad" when it breaks either row rule. This is the flag the browser filters on, so
       it has to be decided here, once, rather than re-derived from the markup. */
    bad: rows.map((r) => r.A !== 1 || r.R === 0),
  };
}

/* -- saying what is wrong ----------------------------------------------------------------- */

/** `n` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/**
 * A comma-joined list of at most {@link NAME_CAP} names, with the remainder counted.
 *
 * The labels are clipped here rather than at render time, because a caption is a sentence and a
 * three-hundred-character task title inside one is not a sentence any more.
 *
 * @param items rows or columns carrying a `label`
 *
 * @example names([{ label: 'a' }, { label: 'b' }]);   // 'a, b'
 */
function names(items) {
  const shown = items.slice(0, NAME_CAP).map((x) => clip(x.label, 40));
  const rest = items.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ', and ' + plural(rest, 'more', 'more') : '');
}

/**
 * A percentage that is never `NaN`, because a zero denominator is a real state here.
 *
 * `NaN` reaching the markup is a check failure and, worse, a caption that reads like a bug in the
 * data rather than in the card.
 *
 * @example pct(1, 0);   // 0
 */
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

/**
 * The sentences the caption prints, in the order a reader wants them.
 *
 * Every sentence ends in a full stop, including the last one before an aside. That is not a style
 * note: the caption is flattened by a screen reader and by copy-paste, and a clause with no
 * terminal punctuation runs straight into the next one and reads as a single garbled statement.
 *
 * @param A the output of {@link audit}
 * @returns `{ head, findings, closing }` -- all plain text, escaped by the caller
 *
 * @example verdict(audit(readData({}))).head;   // 'No tasks and no people, so there is nothing to check.'
 */
function verdict(A) {
  if (!A.nT || !A.nP) {
    const missing = !A.nT && !A.nP ? 'No tasks and no people'
      : !A.nT ? 'No tasks' : 'No people';
    return { head: missing + ', so there is nothing to check.', findings: [], closing: '' };
  }

  /* The assignment count is the caption's lead number and is not repeated here; a sentence that
     restates the figure printed two words earlier reads as a card that has lost its place. */
  const head =
    plural(A.nT, 'task', 'tasks') + ' against ' + plural(A.nP, 'person', 'people') + ', ' +
    pct(A.filled, A.possible) + '% of the ' + A.possible + ' cells filled.';

  const findings = [];

  if (A.noA.length) {
    findings.push(
      plural(A.noA.length, 'task has', 'tasks have') + ' no accountable, so ' +
      (A.noA.length === 1 ? 'it is' : 'they are') + ' owned by nobody: ' + names(A.noA) + '.');
  }
  if (A.manyA.length) {
    findings.push(
      plural(A.manyA.length, 'task has', 'tasks have') + ' more than one accountable, which is ' +
      'the same as having none: ' + names(A.manyA) + '.');
  }
  if (A.noR.length) {
    findings.push(
      plural(A.noR.length, 'task has', 'tasks have') + ' nobody responsible, so ' +
      (A.noR.length === 1 ? 'it is' : 'they are') + ' work nobody does: ' + names(A.noR) + '.');
  }
  if (!A.noA.length && !A.manyA.length && !A.noR.length) {
    findings.push('Every task has exactly one accountable and at least one responsible.');
  }

  if (A.ritual.length) {
    findings.push(
      plural(A.ritual.length, 'person is', 'people are') + ' only ever consulted or informed, on ' +
      RITUAL_FLOOR + ' tasks or more, and responsible for nothing: ' + names(A.ritual) +
      '. That is consultation as ritual rather than for judgement.');
  }

  for (const c of A.bottleneck) {
    findings.push(
      clip(c.label, 40) + ' is accountable for ' + c.A + ' of the ' + A.totalA +
      ' accountabilities on this grid (' + pct(c.A, A.totalA) +
      '%). That is a scheduling constraint, not a compliment.');
  }

  if (A.absent.length) {
    findings.push(
      plural(A.absent.length, 'person appears', 'people appear') + ' in no cell at all: ' +
      names(A.absent) + '.');
  }

  return {
    head,
    findings,
    closing: 'Nothing above was corrected; the grid is drawn exactly as it was given.',
  };
}

/**
 * The one sentence a screen reader gets for the table itself.
 *
 * The table has its own row and column headers, so a reader using one can walk the grid; this is
 * the summary that tells them whether walking it is worth the trouble.
 *
 * @example ariaFor(audit(readData({})));   // 'Responsibility matrix. No tasks and no people, ...'
 */
function ariaFor(A) {
  const v = verdict(A);
  return ('Responsibility matrix. ' + v.head + ' ' + v.findings.join(' ')).replace(/\s+/g, ' ').trim();
}

/* -- emit --------------------------------------------------------------------------------- */

/**
 * The card's id as it may appear inside a double-quoted CSS attribute selector.
 *
 * The id is not viewer-supplied, but it is still a string this file did not write, and a quote in
 * it would end the selector early and leave the rest of the stylesheet as garbage the browser
 * skips in silence.
 *
 * @example cssId('a"b');   // 'a\\"b'
 */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/**
 * A JavaScript literal safe to paste into an inline `<script>`.
 *
 * `<` and `>` become escapes so a value containing a closing script tag cannot end the block
 * early, with the useful side effect that no value can spell an arrow. The QUESTION MARK is
 * escaped for a reason that has bitten two agents on this catalogue: a caller string containing
 * `?.` is optional chaining as far as a raw scan is concerned, so the card's own guard refuses the
 * build with a message about a rule the card did not break. Cheaper to make the data unable to
 * spell the forbidden tokens at all.
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
  const own = '.ck-raci[data-card="' + cssId(id) + '"]';
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
 * Nothing here names a colour. The four letter classes take their hue from `--ck-s1` to `--ck-s4`,
 * which is the one place those tokens are exactly right: R, A, C and I are a NOMINAL set, hue is
 * the nominal channel, and the series tokens are hue-separated at equal lightness so no letter
 * reads as louder than another by accident. An ordered ramp would be wrong here for the same
 * reason it is right on a bullet chart.
 *
 * Colour never carries the letter. The glyph is the encoding; the accountable letter additionally
 * wears a ring, so A is findable in a greyscale print or by a reader who sees no colour at all,
 * and the row flag says the violation in words.
 */
function cardCss(id) {
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    /* The scroller owns both axes. Forty people scrolls sideways inside the card and three hundred
       tasks scrolls under the header, so neither ever widens the desk column. */
    ['.ck-rc-scroll', 'max-height: 68vh; overflow-y: auto; margin-top: 10px;'],

    ['table.ck-rc', 'border-collapse: separate; border-spacing: 0; font-size: 12px;'],

    ['.ck-rc th', 'background: var(--ground); font-weight: 400; text-align: left;'],
    ['.ck-rc thead th',
     'position: sticky; top: 0; z-index: 2; vertical-align: bottom; ' +
     'border-bottom: 1px solid var(--rule); padding: 4px 0 5px;'],
    ['.ck-rc tbody th',
     'padding: 4px 10px 4px 2px; vertical-align: top; color: var(--ink); ' +
     'border-bottom: 1px solid var(--hairline); max-width: 34ch;'],
    ['.ck-rc td',
     'padding: 3px 0; text-align: center; border-bottom: 1px solid var(--hairline); ' +
     'border-left: 1px solid var(--hairline); min-width: 23px;'],

    ['.ck-raci.ck-rc-dense .ck-rc td', 'padding: 0;'],
    ['.ck-raci.ck-rc-dense .ck-rc tbody th', 'padding: 1px 8px 1px 2px;'],

    /* The rotated column head. writing-mode plus a half turn gives bottom-to-top text that stays
       real selectable text, which an SVG label would not: a RACI grid is something people copy
       out of, and a picture of a name cannot be pasted. */
    ['.ck-rc-vh',
     'writing-mode: vertical-rl; transform: rotate(180deg); display: inline-block; ' +
     'font-family: var(--mono); font-size: 10px; color: var(--ink-dim); ' +
     'max-height: 132px; overflow: hidden; padding: 0 3px;'],

    ['.ck-rc-task', 'display: inline-block; vertical-align: top;'],

    /* The letter is the encoding. Everything else on this line reinforces it. */
    ['.ck-rc-l',
     'display: inline-block; min-width: 15px; height: 15px; line-height: 15px; ' +
     'font: 700 10px/15px var(--mono); border-radius: 3px; margin: 0 1px;'],
    ['.ck-rc-R', 'color: var(--ck-s4); background: var(--pill);'],
    ['.ck-rc-A', 'color: var(--ck-s1); background: var(--pill); box-shadow: inset 0 0 0 1px var(--ck-s1);'],
    ['.ck-rc-C', 'color: var(--ck-s6); background: transparent;'],
    ['.ck-rc-I', 'color: var(--ink-faint); background: transparent;'],

    ['.ck-rc-flag', 'display: inline-block; width: 13px; height: 13px; line-height: 0; color: var(--ck-s1); vertical-align: -2px; margin-right: 4px;'],
    ['.ck-rc-flag svg', 'width: 13px; height: 13px; display: block;'],
    ['.ck-rc tbody tr[data-bad="1"] th', 'color: var(--ink);'],
    ['.ck-rc tbody tr[data-bad="1"] td', 'background: var(--well);'],
    ['.ck-rc tbody tr[hidden]', 'display: none;'],
    ['.ck-rc tbody tr:hover td', 'background: var(--pill);'],

    ['.ck-rc tfoot th, .ck-rc tfoot td',
     'border-top: 1px solid var(--rule); border-bottom: none; ' +
     'font-family: var(--mono); font-size: 10px; color: var(--ink-faint); padding-top: 5px;'],
    ['.ck-rc-count', 'font-family: var(--mono); font-size: 10px; color: var(--ink-faint);'],
    ['.ck-raci.ck-rc-nocounts .ck-rc-count', 'display: none;'],
    ['.ck-raci.ck-rc-nocounts .ck-rc tfoot', 'display: none;'],

    ['.ck-rc-none td',
     'padding: 15px 9px; text-align: center; font-family: var(--mono); ' +
     'font-size: 11px; color: var(--ink-faint);'],
    ['.ck-rc-none[hidden]', 'display: none;'],
    ['.ck-rc-void', 'font-family: var(--mono); font-size: 11px; color: var(--ink-faint); padding: 12px 0 4px;'],

    ['.ck-rc-find', 'margin: 0 0 4px; display: block;'],

    ['.ck-legend i.sw-R', 'background: var(--ck-s4);'],
    ['.ck-legend i.sw-A', 'background: var(--ck-s1);'],
    ['.ck-legend i.sw-C', 'background: var(--ck-s6);'],
    ['.ck-legend i.sw-I', 'background: var(--ink-faint);'],

    /* Off screen but still in the accessibility tree and still in textContent, which is what a
       copy-paste and a screen reader read: a violation drawn as a triangle still says its words. */
    ['.ck-rc-sr',
     'position: absolute; width: 1px; height: 1px; overflow: hidden; ' +
     'clip-path: inset(50%); white-space: nowrap;'],

    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n';
}

/** The drawn violation glyph. An emoji warning sign is a font lottery at 13px; this is one shape. */
const FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
             '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/></svg>';

/**
 * One row's cells, one per person, in the order the people were given.
 *
 * A cell holding no letters is emitted anyway, empty. The column has to keep its place or the row
 * below it lines up against different people, which is the one failure a matrix cannot survive.
 *
 * The letter is the only thing in the cell's text. An off-screen expansion was tried and removed:
 * it made every cell flatten as "ARaccountable and responsible", so a copy-paste of a forty-person
 * grid came out as prose. The word lives in the letter's own `title`, in the cell's `title`, and
 * in the visible legend under the table, which serves every reader rather than only one.
 *
 * @example cellsFor(0, R);   // '<td class="ck-rc-c" title="…"><b class="ck-rc-l ck-rc-A" …>A</b></td>'
 */
function cellsFor(ti, R) {
  const e = CK.esc;
  const out = [];
  for (let pi = 0; pi < R.people.length; pi++) {
    const letters = R.grid.get(ti + '|' + pi);
    if (!letters) { out.push('<td class="ck-rc-c"></td>'); continue; }
    const words = letters.map((ch) => LETTER_WORD[ch]).join(' and ');
    const marks = letters
      .map((ch) => '<b class="ck-rc-l ck-rc-' + ch + '" title="' + LETTER_WORD[ch] + '">' + ch + '</b>')
      .join('');
    /* The trailing space is load-bearing and invisible. A table cell's text is concatenated with
       the next cell's by `textContent`, so a row without it flattens to "zeroRCI10" -- the task
       name fused to its letters fused to its counts. It collapses to nothing on screen. */
    out.push('<td class="ck-rc-c" title="' + e(R.people[pi].label + ': ' + words) + '">' +
             marks + ' </td>');
  }
  return out.join('');
}

/**
 * The visible key for the four letters.
 *
 * A legend rather than hidden text, because the question "what does C mean here" is asked by
 * sighted readers at least as often. Every entry carries its own trailing space and full stop:
 * `.ck-legend` is a flex row, and a flex container drops whitespace-only text nodes, so a
 * separator written between two spans would vanish from the flattened text and fuse the words.
 *
 * @example legendHtml().indexOf('responsible') > 0;   // true
 */
function legendHtml() {
  return '<div class="ck-legend">' +
    LETTERS.map((ch) =>
      '<span><i class="sw-' + ch + '"></i>' + ch + ', ' + LETTER_WORD[ch] + '. </span>').join('') +
    '</div>';
}

/**
 * The card's markup: one section, a gear, a settings panel, the grid and the caption.
 *
 * Every interpolated value goes through `CK.esc`, which drops control characters before it
 * escapes the five HTML metacharacters -- so a task label carrying a closing script tag, an
 * `onerror` attribute or a NUL comes out as text in all three cases.
 */
function cardHtml(id, title, R, A) {
  const e = CK.esc;
  const v = verdict(A);

  const empty = (!A.nT || !A.nP)
    ? '  <div class="ck-rc-void">nothing to draw &mdash; this matrix has ' +
      (!A.nT && !A.nP ? 'no tasks and no people' : !A.nT ? 'no tasks' : 'no people') + '</div>\n'
    : '';

  /* Every cell's text ends with a space. Table cells flatten straight into one another, so
     without it a header row reads "taskanabencydeeeveRA". */
  const head =
    '<tr><th scope="col" class="ck-rc-corner">task </th>' +
    R.people.map((p) =>
      '<th scope="col"><span class="ck-rc-vh" title="' + e(p.label) + '">' +
      e(clip(p.label, PERSON_CHARS)) + ' </span></th>').join('') +
    '<th scope="col" class="ck-rc-count" title="responsible count">R </th>' +
    '<th scope="col" class="ck-rc-count" title="accountable count">A </th></tr>';

  const body = A.rows.map((row, ti) => {
    const why = [];
    if (row.A === 0) why.push('no accountable');
    if (row.A > 1) why.push(row.A + ' accountable');
    if (row.R === 0) why.push('nobody responsible');
    const flag = why.length
      ? '<span class="ck-rc-flag" title="' + e(why.join('; ')) + '">' + FLAG + '</span>' +
        '<span class="ck-rc-sr">' + e(why.join('; ') + '. ') + '</span>'
      : '';
    return '<tr data-bad="' + (A.bad[ti] ? '1' : '0') + '">' +
           '<th scope="row" title="' + e(row.label) + '">' + flag +
           '<span class="ck-rc-task">' + e(clip(row.label, TASK_CHARS)) + ' </span></th>' +
           cellsFor(ti, R) +
           '<td class="ck-rc-count">' + row.R + ' </td>' +
           '<td class="ck-rc-count">' + row.A + ' </td></tr>';
  }).join('\n      ');

  const span = R.people.length + 3;
  const none = '<tr class="ck-rc-none" hidden><td colspan="' + span +
               '">every task passes both row rules, so nothing is left to show</td></tr>';

  const foot =
    '<tr><th scope="row">accountable for </th>' +
    A.cols.map((c) => '<td>' + c.A + ' </td>').join('') +
    '<td class="ck-rc-count"></td><td class="ck-rc-count">' + A.totalA + ' </td></tr>' +
    '<tr><th scope="row">appears on </th>' +
    A.cols.map((c) => '<td>' + c.tasks + ' </td>').join('') +
    '<td class="ck-rc-count"></td><td class="ck-rc-count"></td></tr>';

  const grid = (!A.nT || !A.nP) ? '' :
    '  <div class="ck-scroll ck-rc-scroll">\n' +
    '    <table class="ck-rc">\n' +
    '      <caption class="ck-rc-sr">' + e(ariaFor(A)) + '</caption>\n' +
    '      <thead>' + head + '</thead>\n' +
    '      <tbody>\n      ' + (body ? body + '\n      ' : '') + none + '\n      </tbody>\n' +
    '      <tfoot>' + foot + '</tfoot>\n' +
    '    </table>\n' +
    '  </div>\n';

  const junk = [];
  if (R.dupeIds) junk.push(plural(R.dupeIds, 'duplicate id was', 'duplicate ids were') + ' dropped from the axes');
  if (R.drop.dupe) junk.push(plural(R.drop.dupe, 'duplicate cell was', 'duplicate cells were') + ' dropped, first one kept');
  if (R.drop.badRef) junk.push(plural(R.drop.badRef, 'cell named', 'cells named') + ' a task or person that does not exist');
  if (R.drop.badLetter) {
    junk.push(plural(R.drop.badLetter, 'cell was', 'cells were') + ' refused for carrying ' +
              (R.strayChars.length === 1 ? 'the letter ' : 'the letters ') +
              R.strayChars.slice(0, 6).join(', ') + ', which ' +
              (R.strayChars.length === 1 ? 'is not one of' : 'are not among') + ' R, A, C and I');
  }

  /* Each finding is its own block, and the separating space lives INSIDE the element rather than
     between two of them. Two flattenings have to work and they fail differently: `textContent`
     concatenates block children with nothing between them, so a sentence ending in a full stop
     runs straight into the next one's first word, and a flex container drops whitespace-only text
     nodes outright, which is how a real card shipped the words "scope moved6 added". A trailing
     space that is part of the element's own text survives both. */
  const findings = v.findings
    .map((s) => '<i class="ck-rc-find">' + e(s) + ' </i>')
    .join('');

  return '<section data-card="' + e(id) + '" class="ck-raci">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-only">show</label>\n' +
    '    <select id="' + e(id) + '-only" name="only">\n' +
    '      <option value="all">every task</option>\n' +
    '      <option value="problems">only tasks that break a rule</option>\n' +
    '    </select>\n' +
    '    <label for="' + e(id) + '-dense">dense rows</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-dense" name="dense">\n' +
    '    <label for="' + e(id) + '-counts">count columns</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-counts" name="counts">\n' +
    '    <div class="ck-set-foot">the task order and the person order are fixed and cannot be ' +
    'sorted: one is the order of the plan and the other is the order of the team, and a grid ' +
    'that reorders itself no longer lines up against either.</div>\n' +
    '  </div>\n' +
    empty + grid +
    '  <div class="ck-cap"><b>' + e(String(A.filled)) + '</b> assignments. ' + e(v.head) + ' ' +
    findings +
    (v.closing ? '<i class="ck-rc-find">' + e(v.closing) + ' </i>' : '') +
    '<i class="ck-rc-shown"></i>' +
    (junk.length ? '<span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '') +
    '</div>\n' +
    ((!A.nT || !A.nP) ? '' : '  ' + legendHtml() + '\n') +
    '</section>\n';
}

/**
 * The browser half: hiding rows and toggling two classes, never building a cell.
 *
 * Classic script, ES5 vocabulary, built by concatenation and passed through
 * {@link guardEmitted} -- a backtick that got into a comment here would close the desk's one
 * inline script block early and blank every card on the page, not just this one.
 *
 * The filter is the only stateful thing, and it is a repaint by construction: it sets `hidden` on
 * every row on every run, so replaying the builder after a `<main>` swap lands on exactly the
 * state it landed on the first time rather than accumulating anything.
 */
function cardJs(id) {
  const src =
    '/* raci card: the grid was drawn in Node. This hides rows and toggles two classes. */\n' +
    'CK.build(' + jsLit(id) + ', function (sec) {\n' +
    '\n' +
    '  var table = sec.querySelector("table.ck-rc");\n' +
    '  var shownEl = sec.querySelector(".ck-rc-shown");\n' +
    '  if (!table || !table.tBodies[0]) { return; }\n' +
    '\n' +
    '  var body = table.tBodies[0];\n' +
    '  var none = body.querySelector("tr.ck-rc-none");\n' +
    '\n' +
    '  /* Captured once, in source order, which is the only order this card has. */\n' +
    '  var rows = [], all = body.rows, i;\n' +
    '  for (i = 0; i < all.length; i++) {\n' +
    '    if (all[i] !== none) { rows.push(all[i]); }\n' +
    '  }\n' +
    '\n' +
    '  function apply(cfg) {\n' +
    '    var only = cfg.only === "problems" ? "problems" : "all";\n' +
    '    var live = 0, k;\n' +
    '\n' +
    '    sec.classList.toggle("ck-rc-dense", !!cfg.dense);\n' +
    '    sec.classList.toggle("ck-rc-nocounts", !cfg.counts);\n' +
    '\n' +
    '    for (k = 0; k < rows.length; k++) {\n' +
    '      var bad = rows[k].getAttribute("data-bad") === "1";\n' +
    '      rows[k].hidden = only === "problems" && !bad;\n' +
    '      if (!rows[k].hidden) { live++; }\n' +
    '    }\n' +
    '\n' +
    '    if (none) { none.hidden = live !== 0 || rows.length === 0; }\n' +
    '\n' +
    '    /* Set, never appended: the desk swaps its main element and replays every builder, and a\n' +
    '       line that grew by one sentence per swap is the bug this sentence exists to prevent. */\n' +
    '    if (shownEl) {\n' +
    '      shownEl.textContent = live === rows.length\n' +
    '        ? ""\n' +
    '        : "Showing " + live + " of " + rows.length + " tasks. ";\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  CK.settings(sec, ' + jsLit(defaults) + ', apply);\n' +
    '});\n';

  return guardEmitted(src, 'cardkit/raci');
}

/**
 * Build one RACI card.
 *
 * Every degenerate case has a decided answer rather than a crash, and every one of them is said
 * out loud rather than repaired:
 *
 * - **no data at all** draws no table and says the matrix has no tasks and no people
 * - **zero people** or **zero tasks** does the same, naming which axis is missing
 * - **a row with no A** and **a row with two As** are drawn as given, flagged in the row, counted
 *   in the caption and named
 * - **a row with no R** is flagged the same way
 * - **an unrecognised letter** refuses that cell, counts it, and names the character
 * - **a person in no cell at all** is counted and named; the column stays, empty
 * - **duplicate ids** on either axis keep the first and count the rest
 * - **duplicate cells** keep the first and count the rest, because merging them would invent an
 *   assignment nobody made
 * - **all rows identical** is not an error and draws normally; the rule findings will simply
 *   repeat, which is the truth about that input
 * - **forty people** and **three hundred tasks** scroll inside the card rather than widening it
 * - **a three-hundred-character label** is clipped with the cut marked and kept whole in `title`
 *
 * @param id    unique on the desk; becomes `data-card`, the CSS scope and the settings key
 * @param title the card's heading, rendered as plain text
 * @param data  see {@link meta} for the shape; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries the audit's own numbers, so a test or a
 *          reader can check what the caption claims without re-deriving it
 * @throws {Error} from {@link guardEmitted} when the emitted script would break the desk
 *
 * @example
 * build({ id: 'launch', title: 'who owns the launch', ord: 30, data: {
 *   tasks:  [{ id: 'copy', label: 'write the copy' }, { id: 'ship', label: 'ship it' }],
 *   people: [{ id: 'ana' }, { id: 'ben' }],
 *   cells:  [['copy', 'ana', 'A'], ['copy', 'ben', 'R'], ['ship', 'ana', 'AR']],
 * } }).json.noAccountable;   // 0
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'raci' : id);
  const heading = String(title == null ? cardId : title);

  const R = readData(data);
  const A = audit(R);

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      category: meta.category,
      tasks: A.nT,
      people: A.nP,
      assignments: A.filled,
      noAccountable: A.noA.length,
      manyAccountable: A.manyA.length,
      noResponsible: A.noR.length,
      ritual: A.ritual.length,
      bottleneck: A.bottleneck.map((c) => c.id),
      unassigned: A.absent.length,
      totalAccountabilities: A.totalA,
      dropped: { ...R.drop, ids: R.dupeIds },
    },
    html: cardHtml(cardId, heading, R, A),
    css: cardCss(cardId),
    js: cardJs(cardId),
  };
}

export default { meta, defaults, build };
