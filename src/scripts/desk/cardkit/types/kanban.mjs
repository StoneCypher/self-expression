/**
 * The `kanban` card type — work in columns by state, where the WIP limit is the whole point.
 *
 * A board without limits is a todo list in three piles. The limit is the entire mechanism the
 * method exists to provide: it is what converts "start more things" into "finish the things you
 * started", and it only works if breaking it is loud. So this card carries the over-limit signal
 * three times over — a banner above the board naming every offending column and by how much, an
 * outline and a bold count on the column itself, and a pill inside it reading "over by N" — and
 * there is deliberately **no setting that turns any of them off**. A quiet warning on the one
 * signal a chart exists to carry is a design failure, not a matter of taste.
 *
 * Being exactly AT the limit is drawn as a good state rather than as a warning, because it is: at
 * the limit is the design point of the method, and the correct next action is to finish something
 * rather than to start one. The card labels it "at limit" in `--good` and says in the caption that
 * the next arrival puts the column over.
 *
 * Four decisions worth defending before you read the code:
 *
 *   1. **Tiles do not drag, and will not.** Moving a tile in the browser changes the picture
 *      without changing the source of truth, so the board then disagrees with the system it claims
 *      to describe — and a viewer looking at it has no way to know which of the two is lying.
 *      `localStorage` cannot rescue this: it is per viewer, and project state is shared by
 *      definition, so a "moved" tile would be moved for one person and in its old column for
 *      everyone else. A board is a rendering of a system of record; the place to move a card is
 *      the system of record. The one thing a drag could honestly do is dispatch an event and
 *      leave the tile where it is until fresh data arrives — which is `ledger`'s verb model, in
 *      this same catalogue, and is the right shape for anyone who wants it. See
 *      {@link build}'s notes for the case against my own position.
 *   2. **An item whose state matches no column is refused, named, and never placed.** Inventing a
 *      column for it would put a column on the board that the workflow does not have, which is a
 *      lie about the process rather than about one item. The items are listed under the board with
 *      the state name they actually carry, so nothing the caller handed over is lost and nothing
 *      is invented.
 *   3. **The board is a snapshot with no memory, and says so.** It can tell you a column is over
 *      its limit; it cannot tell you whether it has been over for an hour or a month, and that
 *      duration is usually the more important fact. The caption points at `cfd`, the cumulative
 *      flow diagram, for the history — the same way `gauge` points at `bullet`. A card that names
 *      the better tool for the adjacent question is more useful than a card that pretends to be
 *      complete.
 *   4. **Item age is shown where the data carries it, and refused where it does not.** A tile that
 *      has sat in one column a long time is the single most actionable thing on a board and boards
 *      routinely fail to show it, so every tile carrying a state-entry timestamp shows its age,
 *      the oldest tile in each column is marked, the caption names the oldest on the board, and
 *      the tiles can be sorted oldest-first. Where the timestamp is missing the card says the age
 *      is unknown rather than substituting a creation date, which is a different fact wearing the
 *      same units.
 *
 * As with `ledger` and `table`, every tile is rendered here, in Node, escaped, in source order.
 * The browser half only ever REORDERS and hides markup that already exists, so a card with a dead
 * script is a correct board in the order it was given, and replaying the builder after a `<main>`
 * swap repaints rather than appending a second copy of everything.
 *
 * @see ./ledger.mjs — rows with status markers and per-row verbs; the event model a board that
 *                     wanted to be interactive should borrow
 * @see ./gantt.mjs  — when the work is scheduled rather than queued
 */

import { readFileSync }    from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` is a classic script that assigns `window.CK`; it is not a module and cannot be
 * imported. Loading it rather than re-implementing `esc` is the contract's rule and the reason is
 * concrete: a card whose Node side and browser side disagree about what is safe has a hole in
 * whichever of the two is more permissive.
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
  catch (e) { throw new Error('cardkit/kanban: cannot read ' + where.pathname + ' - ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/kanban: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/** At most this many off-board items are listed by name; the rest are counted. */
const OFF_SHOWN = 20;

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * There is deliberately no setting for the WIP-limit signal. A control that hides the one thing
 * the card exists to say is a control that will be found switched on, by someone who does not
 * remember switching it, on the day the board is over its limits.
 *
 * `showAge` defaults on because age is the most actionable fact a board carries; `sort` defaults
 * to `given` because the caller's order is a decision the caller made, and oldest-first is one
 * click away.
 *
 * @example defaults.sort;   // 'given'
 */
export const defaults = { dense: false, showAge: true, sort: 'given' };

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * @example meta.name;                    // 'kanban'
 * @example Object.keys(meta.defaults);   // ['dense', 'showAge', 'sort']
 */
export const meta = {
  name: 'kanban',
  summary: 'Work in columns by workflow state, with WIP limits that say loudly and numerically ' +
           'when a column is over one.',
  shape: '{ columns: [{ key, label, limit }], ' +
         'items: [{ id, title, state, tag, who, since, blocked }], now } — ' +
         'state must equal a column key or the item is refused rather than given a new column; ' +
         'limit is a positive whole number or absent; since is when the item entered its current ' +
         'column, ISO or epoch ms; now is the reference time ages are measured from',
  category: 'work-and-lists',
  defaults: { ...defaults },
};

/* ── escaping and embedding ──────────────────────────────────────────────────────────────── */

/**
 * Drop C0 control characters and DEL from a caller's text.
 *
 * Written as code-point arithmetic rather than as a character class, per contract rule 6: a class
 * has to be spelled with escapes, and an escape decoded one step too early puts the raw control
 * character into this file, where it is invisible in every editor, legal to the parser, and
 * survives `node --check`. Comparing numbers cannot go wrong that way.
 *
 * Tab and newline go too: a tile title is running text, and a tab in it is a paste accident or an
 * attempt to fake a column on a card that already has real ones.
 *
 * @param s the text to clean
 * @returns the text with nothing invisible left in it
 *
 * @example clean('a\tb').length;   // 2
 */
function clean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out;
}

/**
 * A JavaScript string literal for a value, safe to paste into the emitted classic script.
 *
 * `JSON.stringify` alone is not enough inside a `<script>`: `</` closes it, and U+2028/U+2029 are
 * line terminators to a JS parser but not to JSON. The backtick and the question mark are escaped
 * for a different reason — the build-time guard refuses any emitted script containing a backtick
 * or optional chaining, and a card id spelling either of those would fail that check with a
 * mystifying message about a rule it did not break. Cheaper to make the data unable to spell the
 * forbidden tokens at all.
 *
 * @param s the text to embed
 * @returns a quoted JavaScript literal
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/`/g, '\\u0060').replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* ── time ────────────────────────────────────────────────────────────────────────────────── */

/**
 * One timestamp as epoch milliseconds, or null when it is not a time.
 *
 * A string that does not parse is refused rather than coerced. `Number('')` is 0 and
 * `new Date('soon')` is not a time; either one would invent an age for an item nobody dated, and
 * an invented age on this card is worse than no age at all, because age is the thing a reader is
 * most likely to act on.
 *
 * @param v anything a caller might hand over as a time
 * @returns epoch milliseconds, or null
 *
 * @example readTime('2026-08-01T00:00:00Z');   // 1785283200000
 * @example readTime('soon');                   // null
 * @example readTime(Infinity);                 // null
 */
function readTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Two digits, so a month or an hour aligns with the rest of a stamp. */
function pad2(n) { return n < 10 ? '0' + n : String(n); }

/**
 * A timestamp as a readable UTC stamp, for a tile's tooltip.
 *
 * UTC rather than local, because a date written as a plain day parses to UTC midnight and reading
 * it back in the viewer's zone can print the day before — a card that disagrees with the strings
 * it was handed is worse than a coarse one.
 *
 * @example fmtStamp(0);   // '1970-01-01 00:00 UTC'
 */
function fmtStamp(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
         ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
}

/**
 * A duration as the shortest thing that still says how long.
 *
 * Days are kept up to ten weeks rather than rolling into weeks early, because "38d" is a number a
 * reader can compare to a limit and "5w" is a number they have to convert first.
 *
 * @param ms a non-negative duration in milliseconds
 * @returns a compact label
 *
 * @example ageText(0);            // 'just now'
 * @example ageText(3600000);      // '1h'
 * @example ageText(86400000 * 3); // '3d'
 */
function ageText(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 70) return d + 'd';
  return Math.floor(d / 7) + 'w';
}

/**
 * A percentage, rounded, refusing to emit one that is not a number.
 *
 * A non-finite width in an inline style is silent: the declaration is dropped and the bar renders
 * at its natural size, which looks like a deliberate value rather than like a bug.
 *
 * @throws {Error} when v is not finite, which means a bug in the arithmetic rather than bad input
 * @example pct(33.333);   // 33.33
 */
function pct(v) {
  if (!Number.isFinite(v)) throw new Error('kanban: non-finite percentage (' + v + ')');
  return Math.round(v * 100) / 100;
}

/* ── normalisation ───────────────────────────────────────────────────────────────────────── */

/**
 * The columns, deduped, with every limit either a positive whole number or absent.
 *
 * A limit that is not a positive integer is REFUSED rather than rounded. A WIP limit of 3.5 is not
 * a limit anybody set on purpose, and rounding it would silently pick one of the two neighbouring
 * policies; a limit of 0 or a negative one would put every column permanently over, which reads as
 * an alarm about the work when it is an alarm about the configuration. Refused limits are counted
 * and the caption names how many.
 *
 * @param list the caller's `columns`
 * @returns `{ columns, dupes, badLimits }` — columns in declared order with `key`, `label` and
 *   `limit` (a positive integer, or 0 meaning none)
 *
 * @example normColumns([{ key: 'a', limit: 3 }]).columns[0].limit;   // 3
 * @example normColumns([{ key: 'a', limit: 2.5 }]).badLimits;        // 1
 */
function normColumns(list) {
  const seen = Object.create(null);
  const columns = [];
  let dupes = 0, badLimits = 0, auto = 0;

  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;

    let key = raw.key == null ? '' : clean(raw.key);
    if (key === '') { do { key = 'c' + auto++; } while (seen[key]); }
    if (seen[key]) { dupes += 1; continue; }
    seen[key] = true;

    let limit = 0;
    if (raw.limit !== undefined && raw.limit !== null && raw.limit !== false) {
      const n = raw.limit;
      if (typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n > 0) limit = n;
      else badLimits += 1;
    }

    const label = raw.label == null || clean(raw.label) === '' ? key : clean(raw.label);
    columns.push({ key, label, limit });
  }

  return { columns, dupes, badLimits };
}

/**
 * The items, deduped, cleaned, dated, and assigned to a column or to none.
 *
 * Duplicate ids are dropped rather than renamed, and counted so the caption can admit to it: two
 * tiles sharing an id would be two tiles a reader cannot tell apart in any report built from this
 * board. An item with no id gets a synthetic one — failing to name itself does not make a piece of
 * work less real.
 *
 * An item whose `state` names no declared column is not placed. It goes to `stray` with the state
 * string it actually carries, because the useful complaint is "nothing on this board is called
 * *blocked*", not "one item could not be placed".
 *
 * @param list the caller's `items`
 * @param byKey a map of column key to column, for the state lookup
 * @param now the reference time ages are measured from
 * @returns `{ items, stray, dupes, noSince, badSince, futureSince }`
 *
 * @example normItems([{ id: 'a', state: 'x' }], { x: {} }, 0).items.length;   // 1
 * @example normItems([{ id: 'a', state: 'q' }], { x: {} }, 0).stray.length;   // 1
 */
function normItems(list, byKey, now) {
  const seen = Object.create(null);
  const items = [];
  const stray = [];
  let dupes = 0, noSince = 0, badSince = 0, futureSince = 0, auto = 0;

  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;

    let id = raw.id == null ? '' : clean(raw.id);
    if (id === '') { do { id = 'i' + auto++; } while (seen[id]); }
    if (seen[id]) { dupes += 1; continue; }
    seen[id] = true;

    const title = raw.title == null ? '' : clean(raw.title);
    const state = raw.state == null ? '' : clean(raw.state);

    /* Age is settled here, once, so the tile and the caption cannot disagree about it. Three
       distinct failures, counted separately because they mean different things to a caller:
       no timestamp at all, a timestamp that is not a time, and a timestamp in the future. */
    let age = null;
    if (raw.since === undefined || raw.since === null || raw.since === '') {
      noSince += 1;
    } else {
      const t = readTime(raw.since);
      if (t === null) badSince += 1;
      else if (t > now) { futureSince += 1; }
      else age = { at: t, ms: now - t };
    }

    const row = {
      id, title, state, age,
      tag:     raw.tag == null ? '' : clean(raw.tag),
      who:     raw.who == null ? '' : clean(raw.who),
      blocked: raw.blocked === true,
    };

    if (state !== '' && Object.hasOwn(byKey, state)) items.push(row);
    else stray.push(row);
  }

  return { items, stray, dupes, noSince, badSince, futureSince };
}

/**
 * One column's items, its counts, and where it sits against its limit.
 *
 * `wip` is the whole vocabulary of the card's loudest signal and there are exactly four values:
 * `none` for a column that declared no limit, `under`, `at`, and `over`. `at` is not a warning —
 * at the limit is the design point of the method, and the correct next action is to finish
 * something rather than to start one.
 *
 * @param col the normalised column
 * @param items every normalised item, in source order
 * @returns `{ key, label, limit, count, over, wip, tiles, oldest }`
 *
 * @example columnStats({ key: 'a', label: 'a', limit: 2 }, [{ state: 'a' }, { state: 'a' }]).wip;
 * // 'at'
 */
function columnStats(col, items) {
  const tiles = items.filter((it) => it.state === col.key);
  const count = tiles.length;
  const over = col.limit > 0 && count > col.limit ? count - col.limit : 0;
  const wip = col.limit === 0 ? 'none'
            : count > col.limit ? 'over'
            : count === col.limit ? 'at'
            : 'under';

  /* The oldest tile in the column, by measured age. Derived from the data rather than from an
     invented staleness threshold: a threshold would need a constant nobody chose, and "the oldest
     one here" is a fact the board already knows. */
  let oldest = null;
  for (const t of tiles) {
    if (!t.age) continue;
    if (!oldest || t.age.ms > oldest.age.ms) oldest = t;
  }

  return { key: col.key, label: col.label, limit: col.limit, count, over, wip, tiles, oldest };
}

/* ── markup ──────────────────────────────────────────────────────────────────────────────── */

/**
 * One tile.
 *
 * The full title rides in a `title` attribute as well as in the body, because the body is clamped
 * to a few lines: a 300-character title in a 160-pixel column would otherwise either take over the
 * board or be silently truncated, and a tooltip is the cheapest way to keep the whole string
 * reachable without either.
 *
 * `data-age` carries the age in milliseconds so the browser half can sort by it without parsing
 * the label back out of the text — a label is a rendering and re-reading it would make the sort
 * depend on the formatting.
 *
 * @param it     the normalised item
 * @param oldest the column's oldest item, or null
 * @returns markup for one tile
 *
 * @example tileHtml({ id: 'a', title: 't', tag: '', who: '', age: null, blocked: false }, null)
 *   .indexOf('data-id="a"') >= 0;   // true
 */
function tileHtml(it, oldest) {
  const isOldest = oldest !== null && oldest.id === it.id;

  const bits = [];
  if (it.blocked) bits.push('<span class="ck-kb-flag" title="blocked">blocked</span>');
  if (it.tag !== '') bits.push('<span class="ck-kb-tag">' + CK.esc(it.tag) + '</span>');
  if (it.who !== '') bits.push('<span class="ck-kb-who">' + CK.esc(it.who) + '</span>');
  if (it.age) {
    bits.push('<span class="ck-kb-age"' + (isOldest ? ' data-oldest="1"' : '') +
              ' title="' + CK.esc('in this column since ' + fmtStamp(it.age.at) +
                                  (isOldest ? ' \u2014 the oldest here' : '')) + '">' +
              CK.esc(ageText(it.age.ms)) + '</span>');
  } else {
    bits.push('<span class="ck-kb-age ck-kb-noage-one" title="no state-entry timestamp, so this ' +
              'item has no age on this board">age?</span>');
  }

  const shown = it.title === '' ? '<i class="ck-kb-untitled">untitled</i>' : CK.esc(it.title);

  return '<div class="ck-kb-tile" data-id="' + CK.esc(it.id) + '"' +
         (it.age ? ' data-age="' + CK.esc(String(it.age.ms)) + '"' : '') +
         (it.blocked ? ' data-blocked="1"' : '') + '>' +
         '<span class="ck-kb-title" title="' + CK.esc(it.title) + '">' + shown + '</span>' +
         '<span class="ck-kb-foot">' + bits.join('') + '</span>' +
         '</div>';
}

/**
 * One column, head to tiles, including its limit meter.
 *
 * The meter's track spans `max(count, limit)`, so a column at seven against a limit of four draws
 * four units of fill and three of spill — the spill is the overage at the same scale as the work,
 * which is the comparison the reader is trying to make. A tick marks the limit itself, so the
 * boundary stays visible even when the fill has run past it.
 *
 * @param st the column's stats, from {@link columnStats}
 * @returns markup for one column
 *
 * @example columnHtml({ key: 'a', label: 'A', limit: 1, count: 2, over: 1, wip: 'over',
 *   tiles: [], oldest: null }).indexOf('over by 1') >= 0;   // true
 */
function columnHtml(st) {
  const head =
    '<div class="ck-kb-head">' +
    '<span class="ck-kb-name">' + CK.esc(st.label) + '</span>' +
    '<span class="ck-kb-count">' +
      (st.limit > 0
        ? CK.esc(st.count + ' / ' + st.limit)
        : CK.esc(String(st.count)) + '<span class="ck-kb-nolimit"> no limit</span>') +
    '</span></div>';

  let meter = '';
  if (st.limit > 0) {
    const span = Math.max(st.count, st.limit);
    const within = Math.min(st.count, st.limit);
    meter =
      '<div class="ck-kb-meter" aria-hidden="true">' +
      '<i class="ck-kb-fill" style="width: ' + pct(within / span * 100) + '%"></i>' +
      (st.over > 0
        ? '<i class="ck-kb-spill" style="left: ' + pct(within / span * 100) +
          '%; width: ' + pct(st.over / span * 100) + '%"></i>'
        : '') +
      '<i class="ck-kb-tick" style="left: ' + pct(st.limit / span * 100) + '%"></i>' +
      '</div>';
  }

  const flag = st.wip === 'over'
    ? '<div class="ck-kb-over">over by ' + CK.esc(String(st.over)) + '</div>'
    : st.wip === 'at'
      ? '<div class="ck-kb-at">at limit</div>'
      : '';

  const body = st.tiles.length === 0
    ? '<div class="ck-kb-empty">empty</div>'
    : st.tiles.map((t) => tileHtml(t, st.oldest)).join('');

  return '<div class="ck-kb-col" data-col="' + CK.esc(st.key) + '" data-wip="' + st.wip + '">' +
         head + meter + flag +
         '<div class="ck-kb-tiles">' + body + '</div>' +
         '</div>';
}

/**
 * The over-limit banner, or '' when no column is over.
 *
 * Every offending column is named with both numbers and the overage, because "over limit" without
 * the figures is a mood rather than a fact, and the figure is what tells a reader whether to stop
 * the line or to finish one thing.
 *
 * @param stats every column's stats
 * @returns markup, or ''
 *
 * @example alarmHtml([{ label: 'x', count: 3, limit: 1, over: 2, wip: 'over' }]) !== '';   // true
 */
function alarmHtml(stats) {
  const bad = stats.filter((s) => s.wip === 'over');
  if (bad.length === 0) return '';

  const total = bad.reduce((n, s) => n + s.over, 0);
  const parts = bad.map((s) =>
    '<span class="ck-kb-alarm-col"><b>' + CK.esc(s.label) + '</b> ' +
    CK.esc(s.count + ' / ' + s.limit) + ' \u2014 over by ' + CK.esc(String(s.over)) + '</span>');

  /* The spans are joined with a space rather than butted together. A flex container drops a
     whitespace-only text node between its items, so it costs nothing on screen \u2014 and without it
     the banner's words run into each other everywhere the markup is flattened back to text,
     which is what a screen reader and a copy-paste both do. */
  return '<div class="ck-kb-alarm" role="status">' +
         '<span class="ck-kb-alarm-lead">over WIP limit \u00b7 ' +
         (bad.length > 1 ? CK.esc(String(bad.length)) + ' columns \u00b7 ' : '') +
         CK.esc(String(total)) + ' item' + (total === 1 ? '' : 's') + ' too many</span> ' +
         parts.join(' ') + '</div>';
}

/**
 * The items that name a state no column declares, listed rather than placed.
 *
 * Long lists are capped and the remainder counted, because the point of the block is to name the
 * states nobody declared — which needs a handful of examples and an accurate total, not three
 * hundred rows pushing the board off the screen.
 *
 * @param stray the unplaced items
 * @returns markup, or ''
 */
function offBoardHtml(stray) {
  if (stray.length === 0) return '';

  const names = new Map();
  for (const it of stray) {
    const k = it.state === '' ? '' : it.state;
    names.set(k, (names.get(k) || 0) + 1);
  }
  const states = [...names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => '<span class="ck-kb-badstate">' +
         (k === '' ? '<i>no state</i>' : CK.esc(k)) + ' &times;' + CK.esc(String(n)) + '</span>');

  const rows = stray.slice(0, OFF_SHOWN).map((it) =>
    '<li><span class="ck-kb-off-title">' +
    (it.title === '' ? '<i>untitled</i>' : CK.esc(it.title)) + '</span>' +
    '<span class="ck-kb-badstate">' +
    (it.state === '' ? '<i>no state</i>' : CK.esc(it.state)) + '</span></li>').join('');

  const more = stray.length > OFF_SHOWN
    ? '<div class="ck-kb-off-more">and ' + CK.esc(String(stray.length - OFF_SHOWN)) +
      ' more not listed</div>'
    : '';

  return '<div class="ck-kb-off">' +
         '<div class="ck-h3">not on this board</div>' +
         '<p class="ck-kb-off-why"><b>' + CK.esc(String(stray.length)) + '</b> item' +
         (stray.length === 1 ? '' : 's') + ' name a state no column declares. They are listed ' +
         'rather than placed: giving them a column would put a column on the board that the ' +
         'workflow does not have, which is a lie about the process rather than about one item.</p>' +
         '<div class="ck-kb-states">' + states.join('') + '</div>' +
         '<ul class="ck-kb-off-list">' + rows + '</ul>' + more +
         '</div>';
}

/* ── the caption ─────────────────────────────────────────────────────────────────────────── */

/**
 * The sentence a screen reader gets and the sentence a sighted reader gets.
 *
 * The over-limit statement leads, always, and carries its numbers. After it come the per-column
 * counts, the age story, every refusal, and — last, because it is a pointer rather than a finding
 * — the note that a board has no memory and that `cfd` is where the history lives.
 *
 * @param P everything the build computed: stats, refusals, the reference time
 * @returns `{ aria, caption }` — plain text and escaped markup respectively
 */
function boardNote(P) {
  const stats = P.stats;
  const over = stats.filter((s) => s.wip === 'over');
  const at = stats.filter((s) => s.wip === 'at');
  const unlimited = stats.filter((s) => s.limit === 0);
  const shown = P.items.length;

  if (stats.length === 0) {
    const why = 'This board declares no columns, so there is nowhere to put work. ' +
                shown + ' item' + (shown === 1 ? '' : 's') + ' and ' + P.stray.length +
                ' unplaceable; a column is not invented to hold them.';
    return {
      aria: 'Kanban board with no columns. ' + why,
      caption: '<b>no columns</b> \u2014 ' + CK.esc(why),
    };
  }

  const bits = [];
  const ariaBits = [];

  if (over.length) {
    const each = over.map((s) => s.label + ' ' + s.count + ' of ' + s.limit +
                                ' (over by ' + s.over + ')');
    const lead = over.length === 1
      ? '<b>' + CK.esc(over[0].label) + '</b> is <b>over its WIP limit</b>: <b>' +
        CK.esc(String(over[0].count)) + '</b> items against a limit of <b>' +
        CK.esc(String(over[0].limit)) + '</b>, over by <b>' + CK.esc(String(over[0].over)) + '</b>.'
      : '<b>' + CK.esc(String(over.length)) + '</b> columns are <b>over their WIP limits</b>: ' +
        CK.esc(each.join('; ')) + '.';
    bits.push(lead);
    ariaBits.push((over.length === 1 ? 'One column is over its WIP limit: '
                                     : over.length + ' columns are over their WIP limits: ') +
                  each.join('; ') + '.');
    if (at.length) {
      bits.push('Also at limit: <b>' + CK.esc(at.map((s) => s.label).join(', ')) + '</b>.');
      ariaBits.push('Also at limit: ' + at.map((s) => s.label).join(', ') + '.');
    }
  } else if (at.length) {
    const names = at.map((s) => s.label).join(', ');
    bits.push('No column is over its limit. <b>' + CK.esc(names) + '</b> ' +
              (at.length === 1 ? 'is' : 'are') + ' exactly at ' +
              (at.length === 1 ? 'its limit' : 'their limits') +
              ', so the next item to arrive puts ' + (at.length === 1 ? 'it' : 'one of them') +
              ' over.');
    ariaBits.push('No column is over its limit; ' + names + ' at limit.');
  } else if (unlimited.length === stats.length) {
    bits.push('<b>No column on this board declares a WIP limit</b>, so nothing here constrains ' +
              'how much work is started \u2014 which is the one thing the method is for. ' +
              'A board without limits is a list in ' + CK.esc(String(stats.length)) + ' piles.');
    ariaBits.push('No column declares a WIP limit.');
  } else {
    bits.push('Every limited column is <b>under its WIP limit</b>.');
    ariaBits.push('Every limited column is under its WIP limit.');
  }

  const cols = stats.map((s) =>
    CK.esc(s.label) + ' ' + CK.esc(String(s.count)) +
    (s.limit > 0 ? CK.esc(' of ' + s.limit) : '<span class="ck-aside"> (no limit)</span>'));
  bits.push('<span class="ck-kb-cap-cols">' + cols.join(' \u00b7 ') + '.</span>');
  ariaBits.push('Columns: ' + stats.map((s) =>
    s.label + ' ' + s.count + (s.limit > 0 ? ' of ' + s.limit : ', no limit')).join('; ') + '.');

  if (unlimited.length && unlimited.length < stats.length) {
    bits.push('<b>' + CK.esc(String(unlimited.length)) + '</b> of <b>' +
              CK.esc(String(stats.length)) + '</b> columns declare no limit (' +
              CK.esc(unlimited.map((s) => s.label).join(', ')) + '), so nothing constrains them.');
  }

  /* Age. Either the board can show it, or it says it cannot — there is deliberately no third
     branch reaching for a creation date, which is a different fact wearing the same units. */
  const aged = P.items.filter((it) => it.age);
  if (aged.length === 0) {
    bits.push('<b>This board cannot show item age</b>: no item carries a state-entry timestamp. ' +
              'Age is the most actionable thing a board holds and there is no honest proxy for ' +
              'it here, so nothing is shown rather than something inferred.');
    ariaBits.push('No item carries a state-entry timestamp, so no age is shown.');
  } else {
    let oldest = aged[0];
    for (const it of aged) if (it.age.ms > oldest.age.ms) oldest = it;
    const where = P.stateLabel[oldest.state] || oldest.state;
    const label = oldest.title === '' ? 'an untitled item' : oldest.title;
    /* "in column X" rather than "in X": half the boards in the world have a column called
       "in progress", and "12d in in progress" is a sentence nobody can read at a glance. */
    bits.push('Oldest on the board: <b>' + CK.esc(label) + '</b> &mdash; <b>' +
              CK.esc(ageText(oldest.age.ms)) + '</b> without moving, in column <b>' +
              CK.esc(where) + '</b>.');
    ariaBits.push('Oldest on the board: ' + label + ', ' + ageText(oldest.age.ms) +
                  ' without moving, in column ' + where + '.');
    if (aged.length < shown) {
      bits.push('<span class="ck-aside"><b>' + CK.esc(String(shown - aged.length)) +
                '</b> of <b>' + CK.esc(String(shown)) + '</b> items carry no state-entry ' +
                'timestamp and show no age.</span>');
    }
    bits.push('<span class="ck-aside">Ages are measured from ' +
              CK.esc(fmtStamp(P.now)) + (P.nowGiven ? '' : ', the time this card was built') +
              '; nothing on this card ticks.</span>');
  }

  const blocked = P.items.filter((it) => it.blocked).length;
  if (blocked) {
    bits.push('<b>' + CK.esc(String(blocked)) + '</b> item' + (blocked === 1 ? ' is' : 's are') +
              ' flagged blocked.');
  }

  const notes = [];
  if (P.stray.length) {
    notes.push(P.stray.length + (P.stray.length === 1 ? ' item names a state' : ' items name states') +
               ' no column declares; listed below the board rather than given a column');
  }
  if (P.dupes) notes.push(P.dupes + (P.dupes === 1 ? ' duplicate item id dropped' : ' duplicate item ids dropped'));
  if (P.colDupes) notes.push(P.colDupes + (P.colDupes === 1 ? ' duplicate column key dropped' : ' duplicate column keys dropped'));
  if (P.badLimits) notes.push(P.badLimits + (P.badLimits === 1 ? ' column declared a limit that is not a positive whole number' : ' columns declared limits that are not positive whole numbers') + '; refused, not rounded');
  if (P.badSince) notes.push(P.badSince + (P.badSince === 1 ? ' item has a state-entry timestamp that is not a time' : ' items have state-entry timestamps that are not times') + '; refused, not coerced');
  if (P.futureSince) notes.push(P.futureSince + (P.futureSince === 1 ? ' item entered its column in the future' : ' items entered their columns in the future') + '; no age shown for ' + (P.futureSince === 1 ? 'it' : 'them'));
  if (P.badNow) notes.push('the given reference time is not a time; the build time is used instead');

  /* The full stop is not decoration. Without it the last refusal runs straight into the sentence
     after it every time the caption is flattened to text, which a screen reader does. */
  if (notes.length) bits.push('<span class="ck-aside">' + CK.esc(notes.join(' \u00b7 ')) + '.</span>');

  bits.push('<span class="ck-kb-cap-cfd">A board is a snapshot with no memory: it can say a ' +
            'column is over its limit and cannot say whether it has been over for an hour or a ' +
            'month, which is usually the more important fact. <b>cfd</b> in this catalogue ' +
            'carries that history.</span>');

  return {
    aria: 'Kanban board of ' + stats.length + ' columns and ' + shown + ' items. ' +
          ariaBits.join(' ') + ' A board is a snapshot and cannot show how long a column has been ' +
          'over its limit; see the cumulative flow diagram for that.',
    caption: bits.join(' '),
  };
}

/* ── the build-time guard ────────────────────────────────────────────────────────────────── */

/**
 * Blank comment, string and regex bodies while preserving every offset.
 *
 * A raw scan for the words `const`, `let` and `class` false-positives on English prose — one card
 * in this catalogue was refused because a comment said "the class is what CSS reads" — and a guard
 * that cries wolf is a guard somebody switches off. Offsets are preserved so a reported position
 * still points at the right place. Regex literals are recognised, because otherwise the scanner
 * desynchronises on the quote inside `replace(/'/g, x)` and starts blanking real code, which turns
 * a false positive into a far worse false negative.
 *
 * @param src JavaScript source of any length
 * @returns text of exactly the same length, comment and string contents replaced by spaces
 *
 * @example blankNonCode('var a = "const";').indexOf('const');   // -1
 */
function blankNonCode(src) {
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
 * Every card's `js` is concatenated into ONE inline block on the page, so a single backtick — in a
 * comment as readily as in code — closes the surrounding template literal early and blanks every
 * card on the desk. The backtick is never written here; it is reached for as
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
 * @example guardEmitted('var a = 1;');   // returns it
 */
export function guardEmitted(src, who) {
  const where = who || 'cardkit/kanban';
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

/* ── the browser half ────────────────────────────────────────────────────────────────────── */

/**
 * The card's browser half: reordering and hiding, never rendering, and never moving work.
 *
 * Written as one string wrapped in a function expression, so nothing this card defines reaches the
 * global scope — a desk can hold two boards, and a top-level `var` would have them sharing it.
 * Classic script throughout: `var` and `function`, no arrows, no template literals, no optional
 * chaining, because every card's script is concatenated into one inline block and one
 * modern-syntax parse error takes the whole desk down.
 *
 * No listener attaches to a tile. There is no drag, no click-to-advance and no local state, for
 * the reason set out at the top of this file: a tile that moved here would have moved for exactly
 * one viewer, and the board would then disagree with the system it describes with nothing on the
 * page to say which was right.
 *
 * @param id the card's `data-card` value, embedded as a literal
 * @returns the script body
 *
 * @example main('board').indexOf('ck-kb-board') >= 0;   // true
 */
function main(id) {
  return [
    '(function () {',
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var board = sec.querySelector(".ck-kb-board");',
    '    if (!board) { return; }',
    '',
    '    /* Captured once per builder run, in the order Node wrote them. The sort reorders these',
    '       same elements and never creates one, so replaying the builder after a main swap',
    '       repaints the board rather than appending a second copy of every tile. */',
    '    var cols = board.querySelectorAll(".ck-kb-col");',
    '    var lanes = [], i, j, lane, kids, tiles;',
    '    for (i = 0; i < cols.length; i++) {',
    '      lane = cols[i].querySelector(".ck-kb-tiles");',
    '      if (!lane) { continue; }',
    '      tiles = [];',
    '      kids = lane.children;',
    '      for (j = 0; j < kids.length; j++) {',
    '        if (String(kids[j].className).indexOf("ck-kb-tile") >= 0) { tiles.push(kids[j]); }',
    '      }',
    '      lanes.push({ lane: lane, tiles: tiles });',
    '    }',
    '',
    '    /* An item with no state-entry timestamp has no age, not an age of zero. It sorts last',
    '       under oldest-first rather than first, because "unknown" is not "new". */',
    '    function ageOf(el) {',
    '      var a = el.getAttribute("data-age");',
    '      if (a === null || a === "") { return -1; }',
    '      var n = Number(a);',
    '      return isFinite(n) ? n : -1;',
    '    }',
    '',
    '    function byAge(a, b) {',
    '      var av = ageOf(a), bv = ageOf(b);',
    '      if (av < 0 && bv < 0) { return 0; }',
    '      if (av < 0) { return 1; }',
    '      if (bv < 0) { return -1; }',
    '      return bv - av;',
    '    }',
    '',
    '    function apply(cfg) {',
    '      var k, n, row, order, frag;',
    '      sec.classList.toggle("ck-kb-dense", !!cfg.dense);',
    '      sec.classList.toggle("ck-kb-hideage", !cfg.showAge);',
    '      for (k = 0; k < lanes.length; k++) {',
    '        row = lanes[k];',
    '        order = row.tiles.slice(0);',
    '        if (cfg.sort === "age") { order.sort(byAge); }',
    '        /* One reflow: every tile is moved in its new order inside a fragment, and the',
    '           fragment goes back in one call. Moving an element that is already in the tree',
    '           relocates it, so the lane holds the same set it started with. */',
    '        frag = document.createDocumentFragment();',
    '        for (n = 0; n < order.length; n++) { frag.appendChild(order[n]); }',
    '        row.lane.appendChild(frag);',
    '      }',
    '    }',
    '',
    '    CK.settings(sec, ' + JSON.stringify(defaults) + ', apply);',
    '  });',
    '})();',
  ].join('\n');
}

/* ── the build ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build one kanban card.
 *
 * ON DRAG-TO-MOVE, AND THE BEST CASE AGAINST REFUSING IT. The strongest argument for allowing a
 * drag is that a board is a thinking surface as much as a reporting one, and a standup is full of
 * "what if we pulled that back" moves that never touch the tracker. Refusing the gesture makes the
 * card worse for that use, and a viewer who wants it will reach for a real board instead — so the
 * refusal costs a real user a real thing. The refusal still stands, for two reasons the counter
 * argument does not answer. First, a picture that can be edited without the edit going anywhere is
 * indistinguishable from a picture that reports; there is no visual grammar for "this tile is
 * hypothetical" that survives a screenshot, and screenshots of boards are how boards travel.
 * Second, the honest version of the gesture already exists one file over: `ledger` dispatches an
 * event and changes nothing until new data arrives, so the page — which knows what a move MEANS —
 * decides. A board that wanted to be interactive should borrow that, not invent a local truth.
 *
 * Degenerate inputs and what they draw:
 *
 *   no data              a card saying the board declares no columns; nothing is invented
 *   zero columns         the same; every item becomes unplaceable and is listed by state
 *   an empty column      drawn, with an "empty" placeholder — a declared column with nothing in
 *                        it is a real fact about the workflow and hiding it would hide a stage
 *   a state with no column   the item is listed under the board with the state it carries; no
 *                        column is invented for it
 *   no limit beside limits   the column reads "no limit" explicitly, and the caption counts how
 *                        many columns declare none, because unlimited-by-accident and
 *                        unlimited-on-purpose look identical otherwise
 *   exactly at the limit the column reads "at limit" in the good colour, and the caption says the
 *                        next arrival puts it over — at the limit is the design point, not a fault
 *   twice the limit      the banner, the outline and the pill all carry the number
 *   80 items in a column every one is drawn; a column at eighty against a limit of five is exactly
 *                        the picture this card exists to make impossible to miss
 *   duplicate ids        the later is dropped and counted
 *   a bad timestamp      refused and counted; never coerced to a date
 *   no timestamps at all the card says it cannot show age rather than substituting a proxy
 *   a 300-char title     wrapped, clamped to a few lines, and carried whole in a tooltip
 *
 * @param id    the card's identity; becomes its `data-card` and its settings key
 * @param title the heading, rendered as plain text
 * @param data  `{ columns, items, now }`; every value in it is untrusted and escaped
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }`
 *
 * @throws {Error} when the geometry produces a non-finite percentage, or when the emitted script
 *                 would break the desk; both mean a bug here, since bad input is refused on read
 *
 * @example
 * build({ id: 'board', title: 'sprint 14', ord: 30, data: {
 *   columns: [{ key: 'todo', label: 'to do' },
 *             { key: 'doing', label: 'in progress', limit: 3 },
 *             { key: 'done', label: 'done' }],
 *   items: [{ id: 'a-1', title: 'fix the login redirect', state: 'doing',
 *             since: '2026-08-20T09:00:00Z' }],
 *   now: '2026-08-29T12:00:00Z',
 * } }).html.indexOf('data-card="board"') >= 0;   // true
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'kanban' : id);
  const d = data && typeof data === 'object' ? data : {};

  /* The reference time is settled once. A caller who gives one gets a reproducible board; a caller
     who gives none gets the build time, and the caption says which — an age is only meaningful
     against a stated instant, and a card that hides the instant hides half of every age on it. */
  const givenNow = d.now === undefined || d.now === null || d.now === '' ? null : readTime(d.now);
  const badNow = (d.now !== undefined && d.now !== null && d.now !== '') && givenNow === null;
  const now = givenNow === null ? Date.now() : givenNow;

  const cols = normColumns(d.columns);
  const byKey = Object.create(null);
  const stateLabel = Object.create(null);
  for (const c of cols.columns) { byKey[c.key] = c; stateLabel[c.key] = c.label; }

  const parsed = normItems(d.items, byKey, now);
  const stats = cols.columns.map((c) => columnStats(c, parsed.items));

  const P = {
    stats, stateLabel,
    items: parsed.items,
    stray: parsed.stray,
    dupes: parsed.dupes,
    colDupes: cols.dupes,
    badLimits: cols.badLimits,
    noSince: parsed.noSince,
    badSince: parsed.badSince,
    futureSince: parsed.futureSince,
    badNow, now, nowGiven: givenNow !== null,
  };

  const note = boardNote(P);
  const alarm = alarmHtml(stats);
  const off = offBoardHtml(parsed.stray);
  const f = (name) => CK.esc(cardId) + '-' + name;

  const board = stats.length === 0
    ? '<div class="ck-kb-void">nothing to render &mdash; this board declares no columns, and a ' +
      'board with no columns cannot place work without inventing a stage the workflow does not ' +
      'have.</div>'
    : '<div class="ck-scroll"><div class="ck-kb-board" role="group" aria-label="' +
      CK.esc(note.aria) + '">' + stats.map(columnHtml).join('') + '</div></div>';

  const html =
    '<section data-card="' + CK.esc(cardId) + '" class="ck-kanban">\n' +
    '  <h2>' + CK.esc(title == null ? cardId : String(title)) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="board settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + f('dense') + '">dense tiles</label>\n' +
    '    <input type="checkbox" id="' + f('dense') + '" name="dense">\n' +
    '    <label for="' + f('showAge') + '">show age</label>\n' +
    '    <input type="checkbox" id="' + f('showAge') + '" name="showAge">\n' +
    '    <label for="' + f('sort') + '">order</label>\n' +
    '    <select id="' + f('sort') + '" name="sort">' +
         '<option value="given"' + (defaults.sort === 'given' ? ' selected' : '') + '>as supplied</option>' +
         '<option value="age"' + (defaults.sort === 'age' ? ' selected' : '') + '>oldest first</option>' +
         '</select>\n' +
    '    <p class="ck-set-foot">There is no switch for the WIP-limit signal, because a control ' +
         'that hides the one thing this card exists to say would eventually be found switched on. ' +
         'Tiles do not drag either: moving one here would change the picture without changing the ' +
         'system it describes, and nothing on the page could tell you which of the two was ' +
         'lying.</p>\n' +
    '  </div>\n' +
    (alarm ? '  ' + alarm + '\n' : '') +
    '  ' + board + '\n' +
    (off ? '  ' + off + '\n' : '') +
    '  <div class="ck-cap">' + note.caption + '</div>\n' +
    '</section>\n';

  const js = guardEmitted(main(cardId), 'cardkit/kanban');

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: meta.name,
      columns: stats.length,
      items: parsed.items.length,
      unplaced: parsed.stray.length,
      overLimit: stats.filter((s) => s.wip === 'over').map((s) => ({ key: s.key, count: s.count, limit: s.limit, over: s.over })),
      atLimit: stats.filter((s) => s.wip === 'at').map((s) => s.key),
      unlimited: stats.filter((s) => s.limit === 0).length,
      withAge: parsed.items.filter((it) => it.age).length,
      refused: { duplicateItems: parsed.dupes, duplicateColumns: cols.dupes,
                 badLimits: cols.badLimits, badTimestamps: parsed.badSince,
                 futureTimestamps: parsed.futureSince },
      now,
      settings: { ...defaults },
    },
    html,
    css: CSS,
    js,
  };
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch is
   the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The desk is
   one document open in two viewers who want different answers, and the OS only knows how to give
   both of them the same one. */
const CSS = `
  .ck-kanban { position: relative; }

  /* ── the over-limit banner ──────────────────────────────────────────────────────────────
     The loudest thing on the card, by design. It carries the count, the limit and the overage
     for every offending column, because "over limit" without figures is a mood. */

  .ck-kanban .ck-kb-alarm {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px;
    margin: 10px 0 8px; padding: 7px 10px;
    border: 1px solid var(--ck-s1); border-left-width: 4px; border-radius: 5px;
    background: var(--well);
    font-family: var(--mono); font-size: 11px; color: var(--ck-s1);
    font-variant-numeric: tabular-nums;
  }
  .ck-kanban .ck-kb-alarm-lead {
    font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  }
  .ck-kanban .ck-kb-alarm-col { color: var(--ink); }
  .ck-kanban .ck-kb-alarm-col b { color: var(--ck-s1); font-weight: 700; }

  /* ── the board ──────────────────────────────────────────────────────────────────────── */

  .ck-kanban .ck-kb-board { display: flex; align-items: flex-start; gap: 8px; padding: 2px 0 4px; }
  .ck-kanban .ck-kb-col { flex: 1 1 0; min-width: 148px; max-width: 300px; }

  /* The outline is the second of the three over-limit signals, and it is on the column rather
     than on a tile: the column is what broke the rule, and no individual tile did. */
  .ck-kanban .ck-kb-col[data-wip="over"] {
    outline: 1px solid var(--ck-s1); outline-offset: 4px; border-radius: 3px;
  }

  .ck-kanban .ck-kb-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 6px;
    padding-bottom: 4px;
  }
  .ck-kanban .ck-kb-name {
    font: 700 10.5px/1.3 var(--ui); letter-spacing: .08em; text-transform: uppercase;
    color: var(--ink-dim); overflow-wrap: anywhere;
  }
  .ck-kanban .ck-kb-count {
    flex: none; font-family: var(--mono); font-size: 11px; color: var(--ink-dim);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .ck-kanban .ck-kb-col[data-wip="at"] .ck-kb-count { color: var(--good); }
  .ck-kanban .ck-kb-col[data-wip="over"] .ck-kb-count { color: var(--ck-s1); font-weight: 700; }
  .ck-kanban .ck-kb-nolimit { color: var(--ink-faint); font-size: 9.5px; }

  /* ── the limit meter ────────────────────────────────────────────────────────────────────
     The track spans max(count, limit), so the spill past the limit is drawn at the same scale
     as the work inside it — which is the comparison a reader is actually making. The tick keeps
     the boundary visible after the fill has run past it. */

  .ck-kanban .ck-kb-meter {
    position: relative; height: 4px; margin: 0 0 6px;
    background: var(--pill); border-radius: 2px;
  }
  .ck-kanban .ck-kb-fill {
    position: absolute; left: 0; top: 0; bottom: 0; display: block;
    background: var(--ink-faint); border-radius: 2px;
  }
  .ck-kanban .ck-kb-col[data-wip="at"] .ck-kb-fill { background: var(--good); }
  .ck-kanban .ck-kb-col[data-wip="over"] .ck-kb-fill { background: var(--ck-s1); }
  .ck-kanban .ck-kb-spill {
    position: absolute; top: -2px; bottom: -2px; display: block;
    background: var(--ck-s1); border-radius: 2px;
  }
  .ck-kanban .ck-kb-tick {
    position: absolute; top: -3px; bottom: -3px; width: 1px; display: block;
    background: var(--ink);
  }

  .ck-kanban .ck-kb-over, .ck-kanban .ck-kb-at {
    display: block; margin: 0 0 6px; padding: 2px 6px; border-radius: 4px;
    font-family: var(--mono); font-size: 9.5px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase;
  }
  .ck-kanban .ck-kb-over { background: var(--ck-s1); color: var(--ground); }
  .ck-kanban .ck-kb-at {
    background: transparent; color: var(--good); border: 1px solid var(--good);
  }

  /* ── tiles ──────────────────────────────────────────────────────────────────────────── */

  .ck-kanban .ck-kb-tiles { display: flex; flex-direction: column; gap: 4px; }
  .ck-kanban .ck-kb-tile {
    border: 1px solid var(--hairline); border-radius: 5px; background: var(--well);
    padding: 6px 7px;
  }
  .ck-kanban .ck-kb-tile[data-blocked="1"] { border-left: 3px solid var(--ck-s1); }
  .ck-kanban.ck-kb-dense .ck-kb-tile { padding: 3px 6px; }

  /* Clamped rather than truncated with an ellipsis in the data: the whole title is in the tooltip
     and in the accessibility tree, so nothing is lost, and a 300-character title cannot take the
     board over. */
  .ck-kanban .ck-kb-title {
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4;
    overflow: hidden; overflow-wrap: anywhere;
    font-size: 12px; line-height: 1.35; color: var(--ink);
  }
  .ck-kanban.ck-kb-dense .ck-kb-title { -webkit-line-clamp: 2; line-clamp: 2; font-size: 11.5px; }
  .ck-kanban .ck-kb-untitled { font-style: italic; color: var(--ink-faint); }

  .ck-kanban .ck-kb-foot {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 6px; margin-top: 4px;
  }
  .ck-kanban.ck-kb-dense .ck-kb-foot { margin-top: 2px; }
  .ck-kanban .ck-kb-tag {
    font-family: var(--mono); font-size: 9.5px; color: var(--ink-dim);
    background: var(--pill); border: 1px solid var(--pill-edge); border-radius: 3px;
    padding: 0 4px;
  }
  .ck-kanban .ck-kb-who { font-size: 10px; color: var(--ink-faint); }
  .ck-kanban .ck-kb-flag {
    font-family: var(--mono); font-size: 9.5px; font-weight: 700; color: var(--ck-s1);
    letter-spacing: .05em; text-transform: uppercase;
  }

  /* Age sits hard right so a column of tiles reads as a column of durations, which is the scan a
     reader does when they are looking for what is stuck. */
  .ck-kanban .ck-kb-age {
    margin-left: auto; font-family: var(--mono); font-size: 9.5px; color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .ck-kanban .ck-kb-age[data-oldest="1"] { color: var(--ck-s2); font-weight: 700; }
  .ck-kanban .ck-kb-noage-one { font-style: italic; }
  .ck-kanban.ck-kb-hideage .ck-kb-age { display: none; }

  .ck-kanban .ck-kb-empty {
    font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
    padding: 8px 2px; text-align: center;
    border: 1px dashed var(--hairline); border-radius: 5px;
  }

  /* ── the unplaced ───────────────────────────────────────────────────────────────────── */

  .ck-kanban .ck-kb-void, .ck-kanban .ck-kb-off-why {
    font-size: 11.5px; line-height: 1.5; color: var(--ink-faint); margin: 8px 0;
  }
  .ck-kanban .ck-kb-off { border-top: 1px solid var(--hairline); margin-top: 10px; }
  .ck-kanban .ck-kb-off .ck-h3 { margin-top: 12px; }
  .ck-kanban .ck-kb-states { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 6px; }
  .ck-kanban .ck-kb-badstate {
    font-family: var(--mono); font-size: 9.5px; color: var(--ck-s1);
    border: 1px dashed var(--ck-s1); border-radius: 3px; padding: 0 4px;
  }
  .ck-kanban .ck-kb-off-list { list-style: none; margin: 0; padding: 0; }
  .ck-kanban .ck-kb-off-list li {
    display: flex; align-items: baseline; gap: 8px;
    padding: 3px 2px; border-bottom: 1px solid var(--hairline);
  }
  .ck-kanban .ck-kb-off-title {
    flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--ink); overflow-wrap: anywhere;
  }
  .ck-kanban .ck-kb-off-more {
    font-family: var(--mono); font-size: 10px; color: var(--ink-faint); padding: 5px 2px;
  }

  /* ── the caption ────────────────────────────────────────────────────────────────────── */

  .ck-kanban .ck-kb-cap-cols {
    display: block; font-family: var(--mono); font-size: 10.5px; color: var(--ink-dim);
    margin: 3px 0; font-variant-numeric: tabular-nums;
  }
  .ck-kanban .ck-kb-cap-cfd { display: block; margin-top: 4px; color: var(--ink-faint); }
`;

export default { meta, build };
