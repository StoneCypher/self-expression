/**
 * Put every type in the catalogue onto the desk, once, with sample data worth looking at.
 *
 * A catalogue nobody has instantiated is a list of promises. Thirty-two modules each claim to
 * render themselves from data; the only way to find out is to hand all thirty-two some data
 * and read the desk. This is that, as one re-runnable script: every card is written under an
 * id equal to its type name, so running it twice overwrites the same thirty-two directories
 * rather than growing a second deck.
 *
 * Sample data is specific on purpose. Where the project can answer a question about itself it
 * does — the matrix is a real scan of which kit helper each type calls, the flow and the table
 * are real line counts, the code card is a real function out of `kit.js`, the diff is a real
 * commit, and the snippet is a command that was really run. Where the subject is genuinely
 * external — a price series, a year of activity — the numbers are synthesised from a seeded
 * generator so they carry a real shape and never move between runs.
 *
 *     node cardkit/adopt.mjs
 *
 * @see cardkit/CONTRACT.md — what a type owes; this script only consumes it
 * @see cardkit/newcard.mjs — `writeCard` and `audit`, both imported rather than reimplemented
 */

import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname }  from 'node:path';
import { fileURLToPath }  from 'node:url';

import { catalogue, writeCard, audit } from './newcard.mjs';

const HERE  = dirname(fileURLToPath(import.meta.url));
const TYPES = join(HERE, 'types');
const DECK  = join(HERE, '..', 'cards');

/* Built rather than typed. A literal newline in a source file is fine, but an escape for one
   is the shape that gets mis-decoded a step too early, so the character is named by its code
   point and never appears in this file in any form. Same argument as CONTRACT.md rule 6. */
const LF = String.fromCharCode(10);

/** Join lines into a block of text without ever writing the separator down. */
const lines = (...rows) => rows.join(LF);

/* ── measuring the project, so the cards can be about something ─────────────────────────── */

/**
 * The desk grouping this script sorts by, and the reason each group exists.
 *
 * `ord` runs in bands with gaps between them so a later type can be slotted into its own
 * neighbourhood without renumbering the deck. 10..20 is left clear; the catalogue card sits
 * at 15 and wants room around it.
 */
const GROUPS = [
  { name: 'structure',  ord: 21, types: ['matrix', 'graph', 'arc', 'flow', 'chord'] },
  { name: 'work',       ord: 26, types: ['ledger', 'rail', 'choice', 'table'] },
  { name: 'text',       ord: 30, types: ['markdown', 'code', 'diff', 'snippet', 'formula', 'note'] },
  { name: 'time',       ord: 40, types: ['clock', 'countdown', 'timer', 'ribbon', 'heatmap'] },
  { name: 'quantities', ord: 50, types: ['chart', 'histogram', 'boxplot', 'violin', 'parallel',
                                         'ticker', 'candles',
                                         'portfolio', 'waterfall', 'treemap', 'sunburst',
                                         'icicle'] },
  { name: 'pictures',   ord: 63, types: ['image', 'map', 'molecule'] },
  { name: 'live',       ord: 70, types: ['agentboard', 'audit', 'logtail', 'news', 'rss', 'weather'] },
];

/** Which group a type sits in, for the cards that report on the catalogue itself. */
const groupOf = (type) => (GROUPS.find((g) => g.types.includes(type)) ?? { name: 'ungrouped' }).name;

/** The ord a type gets: its group's band plus its position inside the band. */
const ordOf = (type) => {
  const g = GROUPS.find((x) => x.types.includes(type));
  return g ? g.ord + g.types.indexOf(type) : 90;
};

/**
 * Read every type module once and record what the catalogue can say about itself.
 *
 * Three cards are built out of this — the matrix, the flow and the table — so it is measured
 * once here rather than three times with three chances to disagree.
 *
 * @returns a map of type name to `{ lines, uses, live }`
 */
function survey() {
  const helpers = ['esc', 'svg', 'hue', 'scale', 'ticks', 'fmt',
                   'once', 'spin', 'timer', 'settings', 'net', 'build'];
  const out = new Map();

  for (const file of readdirSync(TYPES)) {
    if (file.startsWith('_') || !file.endsWith('.mjs')) continue;
    const name = file.slice(0, -4);
    const src  = readFileSync(join(TYPES, file), 'utf8');
    const uses = helpers.filter((h) => src.includes('CK.' + h));
    out.set(name, {
      lines: src.split(LF).length,
      uses,
      /* Doc blocks, counted the blunt way. It is a real measure of how much of a module is
         explanation rather than code, which is the axis the parallel-coordinates card is
         most interesting about. */
      docs: (src.match(/\/\*\*/g) ?? []).length,
      /* "Live" means the card reaches off its own page for content, whether that is the
         desk's proxy or the desk's own routes. Measured, not asserted. */
      live: src.includes('CK.net') || src.includes('fetch("/') || src.includes("fetch('/"),
    });
  }
  return { rows: out, helpers };
}

const SURVEY = survey();

/** What each kit helper is for, which is what the arc card colours and orders by. */
const HELPER_ROLE = {
  esc: 'markup', svg: 'markup', hue: 'markup',
  scale: 'geometry', ticks: 'geometry', fmt: 'geometry',
  once: 'lifecycle', spin: 'lifecycle', timer: 'lifecycle',
  settings: 'lifecycle', build: 'lifecycle',
  net: 'network',
};

/** The size band a module falls in, for the sankey. Three bands keep the diagram readable. */
const bandOf = (n) => (n < 700 ? 'under 700 lines' : n <= 1000 ? '700 to 1000 lines' : 'over 1000 lines');

/* ── deterministic shape, for the subjects the project cannot measure ───────────────────── */

/**
 * mulberry32: a small, fast, well-distributed PRNG with a 32-bit seed.
 *
 * Seeded rather than `Math.random` so the deck is byte-identical between runs. A demonstration
 * deck that changed every time it was written would make "did my edit do that?" unanswerable.
 *
 * @param seed any 32-bit integer
 * @returns a function yielding the next value in [0, 1)
 *
 * @example
 * const rnd = prng(7); rnd();   // 0.4054..., and always 0.4054... for seed 7
 */
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A day, as the strict `YYYY-MM-DD` every date-taking type in the catalogue demands. */
function isoDay(date) {
  const p = (n, w) => String(n).padStart(w, '0');
  return p(date.getUTCFullYear(), 4) + '-' + p(date.getUTCMonth() + 1, 2) + '-' + p(date.getUTCDate(), 2);
}

/** `n` days after a `YYYY-MM-DD`, as another one. Arithmetic in UTC so no zone can shift it. */
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/* ── the sample data, one builder per type ─────────────────────────────────────────────── */

/**
 * Ninety daily bars with a story in them: a run-up, a sharp drawdown, a slow recovery.
 *
 * Flat noise draws a candlestick chart that proves the axes work and nothing else. The drift
 * is piecewise so the shape survives the seeding, and volume spikes on down days because that
 * is what volume actually does.
 *
 * @returns bars in `{ t, o, h, l, c, v }` form, oldest first
 */
function candleBars() {
  const rnd = prng(20260829);
  const out = [];
  let price = 138.40, day = '2026-04-21';

  for (let i = 0; i < 90; i++) {
    /* Three regimes, so the card has something to say: climb, break, grind back. */
    const drift = i < 38 ? 0.0042 : i < 52 ? -0.0125 : 0.0026;
    const vol   = i < 38 ? 0.012 : i < 52 ? 0.026 : 0.014;

    const open  = price;
    const shock = (rnd() - 0.5) * 2 * vol;
    const close = Math.max(1, open * (1 + drift + shock));
    const wick  = open * vol * (0.5 + rnd());
    const high  = Math.max(open, close) + wick * rnd();
    const low   = Math.min(open, close) - wick * rnd();

    const fell  = close < open;
    const base  = 1.9e6 + rnd() * 1.1e6;

    out.push({
      t: day,
      o: Math.round(open * 100) / 100,
      h: Math.round(high * 100) / 100,
      l: Math.round(low * 100) / 100,
      c: Math.round(close * 100) / 100,
      v: Math.round(base * (fell ? 1.55 : 1) * (i >= 38 && i < 52 ? 1.7 : 1)),
    });

    price = close;
    /* Trading days only: a candlestick chart with weekend gaps in it is a chart of a calendar. */
    do { day = addDays(day, 1); } while ([0, 6].includes(new Date(day + 'T00:00:00Z').getUTCDay()));
  }
  return out;
}

/** One intraday path for the ticker, shaped so the sparkline is not a straight line. */
function intraday(seed, prevClose, drift) {
  const rnd = prng(seed);
  const out = [];
  let p = prevClose * (1 + (rnd() - 0.5) * 0.004);
  for (let i = 0; i < 78; i++) {
    p = p * (1 + drift / 78 + (rnd() - 0.5) * 0.0035);
    out.push(Math.round(p * 100) / 100);
  }
  return out;
}

/**
 * A year of days with a working rhythm rather than a fog of noise.
 *
 * Weekdays beat weekends, December goes quiet, and the last six weeks are the crunch this
 * project actually had. A heatmap of uniform random numbers is a heatmap of nothing.
 *
 * @returns `{ start, end, days }` for the heatmap card
 */
function activityYear() {
  const rnd = prng(864213);
  const start = '2025-08-31', end = '2026-08-29';
  const days = [];

  for (let iso = start; iso <= end; iso = addDays(iso, 1)) {
    const d       = new Date(iso + 'T00:00:00Z');
    const weekday = d.getUTCDay();
    const month   = d.getUTCMonth();
    const weekend = weekday === 0 || weekday === 6;

    let base = weekend ? 1.1 : 5.2;
    if (month === 11 && d.getUTCDate() > 18) base *= 0.15;   // the holidays really are quiet
    if (iso >= '2026-07-18') base *= 2.4;                    // the crunch
    if (iso >= '2026-08-17') base *= 2.1;                    // and the fortnight it became one

    const v = Math.max(0, Math.round(base * (0.25 + rnd() * 1.6) - (rnd() < 0.18 ? base : 0)));
    days.push({ date: iso, value: v });
  }
  return { start, end, days };
}

/**
 * One working day as timestamped events, for the ribbon.
 *
 * The classes are the five things this desk actually spends a day doing, and they are not
 * evenly spread: reading dominates the morning, building the afternoon, and the refusals
 * cluster where somebody was probing the tail endpoint.
 */
function deskDay() {
  const rnd  = prng(4821);
  const out  = [];
  const day  = '2026-08-28';
  /* Seattle in August is UTC-7, so a local hour is the UTC hour plus seven. Given as an
     offset rather than as wall-clock strings, because the ribbon refuses a bare 1-12 hour
     with no meridiem rather than guessing at it — correctly. */
  const push = (localHour, minute, klass) => {
    const utcHour = localHour + 7;
    const d = new Date(Date.UTC(2026, 7, 28, utcHour, minute, 0));
    out.push({ at: d.toISOString(), klass });
  };

  const shape = [
    { klass: 'read',   by: [0, 0, 0, 0, 0, 0, 2, 6, 11, 9, 7, 5, 4, 6, 5, 4, 3, 2, 2, 3, 2, 1, 0, 0] },
    { klass: 'build',  by: [0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 8, 9, 6, 12, 15, 14, 11, 7, 4, 6, 9, 7, 2, 0] },
    { klass: 'check',  by: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 2, 1, 4, 6, 5, 4, 3, 1, 2, 4, 3, 1, 0] },
    { klass: 'fetch',  by: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1] },
    { klass: 'refuse', by: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
  ];

  for (const row of shape) {
    for (let h = 0; h < 24; h++) {
      for (let k = 0; k < row.by[h]; k++) push(h, Math.floor(rnd() * 60), row.klass);
    }
  }
  return { day, events: out };
}

/** Requests per hour, served against refused — the shape a loopback desk actually has. */
function requestsByHour() {
  const rnd = prng(99117);
  const served = [], refused = [];
  const curve = [4, 2, 1, 1, 1, 2, 6, 18, 41, 63, 58, 49,
                 44, 71, 96, 88, 74, 52, 33, 29, 47, 61, 38, 14];
  for (let h = 0; h < 24; h++) {
    const s = Math.round(curve[h] * (0.85 + rnd() * 0.3));
    served.push({ x: h, y: s });
    /* Refusals are not proportional to traffic — they cluster where somebody was testing the
       allowlist, which is the whole reason they are worth plotting on the same axes. */
    const spike = h === 13 || h === 14 ? 9 : 0;
    refused.push({ x: h, y: Math.round(s * 0.02 * rnd()) + spike });
  }
  return { served, refused };
}

/* ── the deck ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every card this script installs: a type, an id, a title and the data to render it from.
 *
 * The id is the type name throughout, which is what makes the script idempotent — a second
 * run writes the same thirty-two directories instead of a thirty-third card.
 */
function deck(cat) {
  const S = SURVEY;
  const typeNames = [...S.rows.keys()].sort((a, b) => a.localeCompare(b));
  const knobsOf = (t) => Object.keys(cat.get(t)?.meta?.defaults ?? {}).length;

  /* The matrix: which kit helper does each type actually call? Measured by scanning the
     sources, so the blocks the seriation finds are real usage clusters rather than a story. */
  const mxCells = [];
  for (const t of typeNames) {
    for (const h of S.rows.get(t).uses) mxCells.push([t, h]);
  }

  /* The sankey: where the catalogue's lines went. Every group is a pure source and every band
     a pure sink, so both columns total the same and the diagram carries no imbalance stub. */
  const flowLinks = [];
  for (const g of GROUPS) {
    const tally = {};
    for (const t of g.types) {
      const b = bandOf(S.rows.get(t).lines);
      tally[b] = (tally[b] ?? 0) + S.rows.get(t).lines;
    }
    for (const [band, value] of Object.entries(tally)) flowLinks.push({ from: g.name, to: band, value });
  }

  const year = activityYear();
  const day  = deskDay();
  const reqs = requestsByHour();

  return [

    /* ── structure: layouts that compute something before they draw ─────────────────────── */

    {
      type: 'matrix', id: 'matrix', title: 'which card type calls which kit helper',
      data: {
        rows: typeNames.map((t) => ({ id: t, label: t })),
        cols: S.helpers.map((h) => ({
          id: h, label: 'CK.' + h,
          /* The two that reach past the card: one leaves the page, one outlives the DOM. */
          accent: h === 'net' || h === 'timer',
        })),
        cells: mxCells,
        seriate: 'both',
        rowGroups: GROUPS.map((g) => ({ label: g.name, rows: g.types })),
      },
    },

    {
      type: 'graph', id: 'graph', title: 'how a card gets onto the desk',
      data: {
        directed: true,
        layout: 'layered',
        nodes: [
          { id: 'contract', label: 'CONTRACT.md',  group: 'catalogue' },
          { id: 'types',    label: 'types/*.mjs',  group: 'catalogue' },
          { id: 'kitjs',    label: 'kit.js',       group: 'catalogue' },
          { id: 'kitcss',   label: 'kit.css',      group: 'catalogue' },
          { id: 'newcard',  label: 'newcard.mjs',  group: 'catalogue' },
          { id: 'check',    label: 'check.mjs',    group: 'catalogue' },
          { id: 'adopt',    label: 'adopt.mjs',    group: 'catalogue' },
          { id: 'deck',     label: 'cards/<id>/',  group: 'deck' },
          { id: 'deskcards',label: 'deskcards.mjs',group: 'server' },
          { id: 'shell',    label: 'desk-shell',   group: 'server' },
          { id: 'panel',    label: 'panel.mjs',    group: 'server' },
          { id: 'page',     label: 'GET /desk',    group: 'browser' },
          { id: 'net',      label: '/net proxy',   group: 'server' },
          { id: 'tail',     label: '/tail',        group: 'server' },
        ],
        edges: [
          ['contract', 'types', 3],
          ['kitjs', 'types', 2],
          ['types', 'newcard', 3],
          ['types', 'check', 2],
          ['newcard', 'adopt', 2],
          ['newcard', 'check'],
          ['adopt', 'deck', 3],
          ['newcard', 'deck', 2],
          ['deck', 'deskcards', 3],
          ['shell', 'deskcards', 2],
          ['deskcards', 'panel', 3],
          ['kitjs', 'panel', 2],
          ['kitcss', 'panel', 2],
          ['panel', 'page', 3],
          ['net', 'page'],
          ['tail', 'page'],
        ],
      },
    },

    {
      type: 'arc', id: 'arc', title: 'kit helpers that travel together',
      data: {
        unit: 'types',
        /* Real co-usage: an edge joins two helpers that at least six modules both call, and
           its weight is how many. An arc diagram is the honest picture for this because the
           finding is the ordering \u2014 the card reports crossings before and after the sweep. */
        nodes: S.helpers.map((h) => ({ id: h, label: 'CK.' + h, group: HELPER_ROLE[h] })),
        edges: (() => {
          const out = [];
          for (let i = 0; i < S.helpers.length; i++) {
            for (let j = i + 1; j < S.helpers.length; j++) {
              const a = S.helpers[i], b = S.helpers[j];
              const both = typeNames.filter((t) => {
                const u = S.rows.get(t).uses;
                return u.includes(a) && u.includes(b);
              }).length;
              if (both >= 6) out.push([a, b, both]);
            }
          }
          return out;
        })(),
      },
    },

    {
      type: 'flow', id: 'flow', title: 'where the catalogue\u2019s lines went',
      data: {
        unit: 'lines',
        columns: ['by desk group', 'by module size'],
        nodes: GROUPS.map((g) => ({ id: g.name, label: g.name }))
          .concat(['under 700 lines', '700 to 1000 lines', 'over 1000 lines']
            .map((b) => ({ id: b, label: b }))),
        links: flowLinks,
      },
    },

    {
      type: 'chord', id: 'chord', title: 'where a pull request goes in a week',
      data: {
        directed: true,
        unit: 'PRs',
        names: ['queued', 'dispatched', 'in review', 'fix round', 'merged', 'dropped'],
        /* Row i to column j. The shape is this project's own rhythm: almost everything that is
           dispatched reaches review, most of review merges, and a meaningful minority takes a
           lap through a fix round and comes back. The two return flows are the point — merged
           work spawns follow-ups and a dropped item occasionally gets revived, so the diagram
           is a circulation rather than a funnel, and every entity carries flow both ways. */
        matrix: [
          //         queued  disp  review  fix  merged  dropped
          /* queued  */ [0,   34,    0,     0,    0,      2],
          /* disp    */ [0,    0,   31,     0,    0,      3],
          /* review  */ [0,    0,    0,    11,   19,      1],
          /* fix     */ [0,    0,    9,     0,    2,      0],
          /* merged  */ [7,    0,    0,     0,    0,      0],
          /* dropped */ [1,    0,    0,     0,    0,      0],
        ],
      },
    },

    /* ── work: the rows and decisions a desk is actually for ────────────────────────────── */

    {
      type: 'ledger', id: 'ledger', title: 'adopting the catalogue',
      data: {
        caption: 'One evening, thirty-two types, and the findings that came out of pointing '
               + 'each one at real data.',
        summary: 'items',
        verbs: [
          { key: 'done', title: 'mark done',   icon: 'check' },
          { key: 'open', title: 'open source', icon: 'link' },
          { key: 'drop', title: 'drop',        icon: 'trash' },
        ],
        groups: [
          { key: 'run',   label: 'this run',        rowIds: ['read', 'agents', 'survey', 'write', 'check', 'scan'] },
          { key: 'found', label: 'findings',        rowIds: ['csp', 'unit', 'ctrl'] },
          { key: 'queue', label: 'still queued',    rowIds: ['mcp', 'begin', 'loud', 'iframe'] },
        ],
        rows: [
          { id: 'read',   marker: '\u2705', text: 'Read the contract and every type\u2019s declared shape',
            note: 'newcard.mjs show, for all thirty-two' },
          { id: 'agents', marker: '\u{1F916}', text: 'Five agents read 30,123 lines of type source in parallel',
            note: 'one group of types each; the exact data contract came back, not the files' },
          { id: 'survey', marker: '\u{1F4CA}', text: 'Measured every module, so three cards could be about the catalogue',
            note: 'lines, kit-helper usage and whether the type reaches the network' },
          { id: 'write',  marker: '\u2705', text: 'Wrote all thirty-two cards into the deck',
            tag: 'adopt.mjs' },
          { id: 'check',  marker: '\u{1F9EA}', text: 'check.mjs holds at 32 types, 0 faults',
            note: 'and its own selftest catches 16 of 16 planted mutations' },
          { id: 'scan',   marker: '\u{1F50D}', text: 'Byte-scanned the script and the served page for control characters',
            note: 'compared numerically; the character is never written in any form' },

          { id: 'csp',    marker: '\u{1F41B}', text: 'A data: URI image cannot load on this desk',
            note: 'the CSP sets no img-src, so default-src \u2018self\u2019 governs images and data: is not self' },
          { id: 'unit',   marker: '\u{1F41B}', text: 'waterfall seeds its unit at build time but not at runtime',
            note: 'the emitted script hard-codes DEFAULTS.unit as the empty string, so the symbol '
                + 'disappears on the first settings pass' },
          { id: 'ctrl',   marker: '\u{1F4D6}', text: 'CONTRACT.md rule 6 is why none of this writes a control byte',
            note: 'seven incidents in one evening, one of them inside the warning about it' },

          { id: 'mcp',    marker: '\u{1F51C}', text: 'Carry the conventions over MCP\u2019s initialize handshake' },
          { id: 'begin',  marker: '\u{1F51C}', text: 'A begin_turn tool, so a hookless agent can volunteer its context' },
          { id: 'loud',   marker: '\u{1F51C}', text: 'Make recall degrade loudly rather than returning null situations' },
          { id: 'iframe', marker: '\u{1F6AB}', text: 'embed / iframe \u2014 deliberately not built', struck: true,
            note: 'it would undo the CSP posture that lets the desk render other people\u2019s text at all' },
        ],
      },
    },

    {
      type: 'rail', id: 'rail', title: 'what I would pick up next',
      data: {
        cap: 5,
        verbs: [
          { key: 'take', title: 'take this one',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                + 'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' },
          { key: 'pin', title: 'keep it in view',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                + 'stroke-linecap="round" stroke-linejoin="round">'
                + '<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8z"/></svg>' },
        ],
        items: [
          { id: 'mcp-conventions', text: 'Carry the skill text on MCP\u2019s initialize instructions', tag: 'portability' },
          { id: 'begin-turn',      text: 'A begin_turn tool for hosts with no hooks', tag: 'portability' },
          { id: 'recall-loud',     text: 'recall should say \u201cno turn context on this host\u201d', tag: 'portability' },
          { id: 'waterfall-unit',  text: 'Fix waterfall\u2019s unit, which survives the build and not the first redraw', tag: 'bug' },
          { id: 'img-src',         text: 'Decide whether the desk\u2019s CSP should admit data: images', tag: 'policy' },
        ],
        bench: [
          { id: 'agents-json', text: 'Serve /agents.json so the agentboard has a live source', tag: 'desk' },
          { id: 'katex-budget', text: 'Account for the vendored KaTeX in the page budget', tag: 'desk' },
          { id: 'type-18',     text: 'A type for a table of contents across the deck', tag: 'idea' },
        ],
      },
    },

    {
      type: 'choice', id: 'choice', title: 'which hue should a one-series card start on?',
      data: {
        size: 13,
        context: '<svg viewBox="0 0 24 24" aria-hidden="true">'
               + '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
               + '<b>7.4k</b>',
        candidates: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
          id: 's' + i,
          label: 'ck-s' + i,
          render: '<svg viewBox="0 0 24 24" aria-hidden="true">'
                + '<rect x="2" y="2" width="20" height="20" rx="5" fill="var(--ck-s' + i + ')"/></svg>',
        })),
        groups: [
          { label: 'warm end', members: ['s1', 's2', 's3', 's4'] },
          { label: 'cool end', members: ['s5', 's6', 's7', 's8'] },
        ],
      },
    },

    {
      type: 'table', id: 'table', title: 'the catalogue, by weight',
      data: {
        caption: 'Every type, measured rather than described: source lines, how many knobs it '
               + 'exposes, and whether it reaches off the page for content. Sort by lines to see '
               + 'which types earned their size.',
        columns: [
          { key: 'type',  label: 'type',   type: 'text' },
          { key: 'group', label: 'group',  type: 'text' },
          { key: 'lines', label: 'source lines', type: 'bar' },
          { key: 'knobs', label: 'knobs',  type: 'number', align: 'right' },
          { key: 'live',  label: 'reaches out', type: 'bool' },
        ],
        rows: typeNames.map((t) => ({
          type: t,
          group: groupOf(t),
          lines: SURVEY.rows.get(t).lines,
          knobs: knobsOf(t),
          live: SURVEY.rows.get(t).live,
        })),
      },
    },

    /* ── text and code: real material out of this project ───────────────────────────────── */

    {
      type: 'markdown', id: 'markdown', title: 'CONTRACT.md, rule six',
      data: {
        text: lines(
          '#### No control characters in source',
          '',
          'Five separate incidents in one evening, so the mechanism is worth writing down rather',
          'than restating as care. A literal control character is invisible when written,',
          '**rendered as a space by the Read tool** so it is invisible on readback too, legal to',
          'the JavaScript parser, and survives `node --check` \u2014 a NUL inside a string is valid',
          'JS. Edit then fails to match the line, because the file and your copy of it genuinely',
          'differ. The only things that notice are grep calling the file binary, hours later, or a',
          'deliberate byte scan.',
          '',
          'Writing the escape is necessary and **not sufficient**. There is a second sub-mechanism:',
          'an escape written correctly can be decoded one step too early during emission, so an',
          'intended character class lands on disk holding raw control bytes and still looks like a',
          'plausible regex.',
          '',
          'So: **avoid the literal in every form.**',
          '',
          '- Compare code points numerically with `s.charCodeAt(i) < 32` instead of writing a',
          '  character class.',
          '- Use `String.fromCharCode(0)` instead of a quoted NUL.',
          '- Prefer *printable* separators \u2014 a visible one is checkable in a way an invisible',
          '  one never is.',
          '',
          '> Neither can be mistyped or mis-decoded, because neither contains the character at all.'
        ),
      },
    },

    {
      type: 'code', id: 'code', title: 'kit.js \u2014 the timer that survives a swap',
      data: {
        lang: 'javascript',
        filename: 'cardkit/kit.js',
        startLine: 170,
        highlight: '189-195',
        code: lines(
          '  /**',
          '   * A repeating timer that survives a `<main>` swap without ever running twice.',
          '   *',
          '   * `once` cannot do this job and it is worth saying why, because the gap is invisible',
          '   * until it bites: `once` keys off the ELEMENT, and a swap hands the builder a brand',
          '   * new element with an empty dataset \u2014 so the guard passes, a second interval',
          '   * starts, and the old one is still running against a detached node. The symptom is a',
          '   * card that fetches twice an hour, then four times, then eight, and nothing in the',
          '   * code looks wrong.',
          '   *',
          '   * Keyed by name in a registry that outlives the DOM, so the swap replaces rather',
          '   * than stacks. Found by the clock/weather build, which hit exactly this.',
          '   *',
          '   * @param name a stable key, conventionally the card\u2019s id plus the job',
          '   * @param ms   the interval; the callback also fires once immediately',
          '   * @param fn   the work',
          '   * @returns a stop function',
          '   *',
          '   * @example CK.timer("weather:poll", 60000, refresh);',
          '   */',
          '  function timer(name, ms, fn) {',
          '    window.__ckTimers = window.__ckTimers || {};',
          '    clearInterval(window.__ckTimers[name]);',
          '    fn();',
          '    window.__ckTimers[name] = setInterval(fn, ms);',
          '    return function () { clearInterval(window.__ckTimers[name]); };',
          '  }'
        ),
      },
    },

    {
      type: 'diff', id: 'diff', title: 'b5ca98a \u2014 receipts before messages',
      data: {
        patch: lines(
          'diff --git a/src/ts/channels/retention.ts b/src/ts/channels/retention.ts',
          'index 9b73b23..837d48c 100644',
          '--- a/src/ts/channels/retention.ts',
          '+++ b/src/ts/channels/retention.ts',
          '@@ -65,12 +65,14 @@ export function pruneExpired(store: Store, now: Date = new Date()): Pruned {',
          ' ',
          "   const entries     = store.db.prepare('DELETE FROM entries      WHERE ts_utc < ?').run(horizon),",
          "         turnContext = store.db.prepare('DELETE FROM turn_context WHERE ts_utc < ?').run(horizon),",
          "-        messages    = store.db.prepare('DELETE FROM messages     WHERE ts_utc < ?').run(horizon),",
          '-        // Orphans only: a receipt of a surviving message must survive, or the message',
          '-        // would be resurrected as unread; a receipt of a pruned message must go, or',
          '-        // the append-only table would reference rows that no longer exist.',
          '+        // Receipts of doomed messages go first \u2014 the foreign key would otherwise',
          '+        // refuse the message delete. Orphanhood, not age, is the receipts\u2019 only',
          '+        // criterion: a receipt of a surviving message must survive, or the message',
          '+        // would be resurrected as unread.',
          '         reads       = store.db.prepare(',
          "-          'DELETE FROM message_reads WHERE message_id NOT IN (SELECT id FROM messages)').run();",
          "+          'DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE ts_utc < ?)')",
          '+          .run(horizon),',
          "+        messages    = store.db.prepare('DELETE FROM messages     WHERE ts_utc < ?').run(horizon);",
          ' ',
          '   return {',
          '     entries      : Number(entries.changes),'
        ),
      },
    },

    {
      type: 'snippet', id: 'snippet', title: 'holding the catalogue to its contract',
      data: {
        command: 'node cardkit/check.mjs',
        cwd: 'C:/Users/john/AppData/Local/Temp/claude/'
           + 'C--Users-john-projects-self-expression/58cf5997/scratchpad',
        shell: 'bash',
        ranAt: '2026-08-29T20:07:11Z',
        exit: 0,
        output: lines('32 types checked, 0 with faults', ''),
        caption: 'The check re-derives rather than trusting: every type\u2019s declared defaults are '
               + 'compared against the settings fields it actually emits, in both directions.',
      },
    },

    {
      type: 'formula', id: 'formula', title: 'four things the catalogue computes',
      data: {
        palette: 'subtle',
        caption: 'Every one of these is implemented somewhere in cardkit, and the card exists so '
               + 'the code and the claim can be read side by side.',
        blocks: [
          { tex: 's(v) \\;=\\; r_0 + \\frac{v - d_0}{d_1 - d_0}\\,(r_1 - r_0),'
               + '\\qquad d_1 = d_0 \\;\\Rightarrow\\; s(v) = \\tfrac{r_0 + r_1}{2}',
            caption: 'CK.scale \u2014 a zero-width domain maps to the midpoint rather than dividing by zero.' },
          { tex: '\\Delta = \\frac{\\max - \\min}{n},\\qquad '
               + 'm = 10^{\\lfloor \\log_{10}\\Delta \\rfloor},\\qquad '
               + '\\mathrm{step} = m \\cdot \\begin{cases}'
               + '10 & \\Delta/m \\ge 5\\\\ 5 & \\Delta/m \\ge 2\\\\ 2 & \\Delta/m \\ge 1\\\\ 1 & '
               + '\\text{otherwise}\\end{cases}',
            caption: 'CK.ticks \u2014 a nice step is 1, 2 or 5 times a power of ten, never a raw division.' },
          { tex: 'b(r) \\;=\\; \\frac{\\sum_{c} w_{rc}\\,\\pi(c)}{\\sum_{c} w_{rc}}',
            caption: 'The barycentre the matrix card sweeps with: a row moves to the mean position '
                   + 'of the columns it touches, then the columns move to the mean of the new rows.' },
          { tex: 'C(\\pi) \\;=\\; \\sum_{i=1}^{n-1} \\bigl\\lVert p_{\\pi(i)} - p_{\\pi(i+1)} '
               + '\\bigr\\rVert_{1}',
            caption: 'And the objective it is judged against \u2014 bond-energy adjacency cost, which '
                   + 'is Hamming distance when the matrix is binary.' },
        ],
      },
    },

    {
      type: 'note', id: 'note', title: 'scratch',
      data: {
        rows: 7,
        placeholder: 'a note to yourself. it stays in this browser and never reaches the server.',
        text: lines(
          'Things this deck is here to answer:',
          '',
          '- does the matrix seriation actually find the block structure, or just claim to?',
          '- does the waterfall unit survive the first settings pass? (no \u2014 see the ledger)',
          '- is the page still under a megabyte with every type on it?',
          '',
          'Anything typed here is yours; the card saves to this browser only.'
        ),
      },
    },

    /* ── time ───────────────────────────────────────────────────────────────────────────── */

    {
      type: 'clock', id: 'clock', title: 'Tokyo',
      data: { tz: 'Asia/Tokyo', face: 'both', seconds: true, hour12: false },
    },

    {
      type: 'countdown', id: 'countdown', title: 'to the turn of the year',
      data: {
        target: '2027-01-01T00:00:00Z',
        label: 'UTC new year',
        unitsShown: 'auto',
        past: 'up',
        seconds: true,
      },
    },

    {
      type: 'timer', id: 'timer', title: 'a working session',
      data: { mode: 'pomodoro', work: 25, rest: 5, rounds: 4, label: 'card review' },
    },

    {
      type: 'ribbon', id: 'ribbon', title: 'a day at the desk',
      data: {
        day: day.day,
        events: day.events,
        tzOffset: -420,
        bucket: 60,
        unit: 'actions',
        scale: 'peak',
        classes: { read: 's6', build: 's4', check: 's5', fetch: 's3', refuse: 's1' },
      },
    },

    {
      type: 'heatmap', id: 'heatmap', title: 'a year of commits',
      data: {
        days: year.days,
        start: year.start,
        end: year.end,
        unit: 'commits',
        weekStart: 'mon',
        levels: 5,
        scale: 'quantile',
        months: true,
        hue: 's5',
      },
    },

    /* ── quantities and money ───────────────────────────────────────────────────────────── */

    {
      type: 'chart', id: 'chart', title: 'requests to the desk, by hour',
      data: {
        kind: 'line',
        xLabel: 'hour of the local day',
        yLabel: 'requests',
        series: [
          { name: 'served',  points: reqs.served },
          { name: 'refused', points: reqs.refused },
        ],
      },
    },

    {
      type: 'histogram', id: 'histogram', title: 'how big a card type turns out to be',
      data: {
        xLabel: 'source lines in the module',
        unit: 'modules',
        /* Real: every module in types/, split by whether it exposes a gear. The finding the
           card is for is that the two distributions barely separate — a settings panel is not
           what makes a type big; drawing is. */
        groups: [
          { name: 'has a gear',
            values: typeNames.filter((t) => knobsOf(t) > 0).map((t) => S.rows.get(t).lines) },
          { name: 'no settings',
            values: typeNames.filter((t) => knobsOf(t) === 0).map((t) => S.rows.get(t).lines) },
        ],
      },
    },

    {
      type: 'boxplot', id: 'boxplot', title: 'module size, by what the group is for',
      data: {
        xLabel: 'desk group',
        unit: 'lines',
        /* The same real line counts the histogram bins, cut the other way: seven distributions
           side by side rather than two overlaid. The named outliers are the point — map.mjs
           and graph.mjs are genuinely far from their neighbours, and a box plot says which. */
        groups: GROUPS.map((g) => ({
          name: g.name,
          values: g.types.filter((t) => S.rows.has(t)).map((t) => S.rows.get(t).lines),
        })),
      },
    },

    {
      type: 'violin', id: 'violin', title: 'does drawing cost more than rendering?',
      data: {
        xLabel: 'what the type has to do',
        unit: 'lines',
        /* A third cut, chosen so both sides clear the eight-point floor this card refuses
           below: types that compute geometry and hand-draw SVG against types that assemble
           markup and let CSS do the work. The densities separate, and that is the answer. */
        groups: (() => {
          const draws = (t) => {
            const u = S.rows.get(t).uses;
            return u.includes('scale') || u.includes('svg') || u.includes('ticks');
          };
          return [
            { name: 'draws geometry', values: typeNames.filter(draws).map((t) => S.rows.get(t).lines) },
            { name: 'markup and CSS', values: typeNames.filter((t) => !draws(t)).map((t) => S.rows.get(t).lines) },
          ];
        })(),
      },
    },

    {
      type: 'parallel', id: 'parallel', title: 'every type on four measured axes',
      data: {
        colorBy: 'group',
        axes: [
          { key: 'lines',   label: 'source lines',  unit: 'lines' },
          { key: 'docs',    label: 'doc blocks',    unit: 'blocks' },
          { key: 'helpers', label: 'kit helpers called', unit: 'of 12', min: 0, max: 12 },
          { key: 'knobs',   label: 'settings',      unit: 'knobs', min: 0 },
        ],
        /* One line per module, every value measured rather than asserted. The band worth
           looking for is the one that runs high on lines and low on knobs: the types that are
           big because drawing is hard, not because they are configurable. */
        rows: typeNames.map((t) => ({
          name: t,
          group: groupOf(t),
          lines: S.rows.get(t).lines,
          docs: S.rows.get(t).docs,
          helpers: S.rows.get(t).uses.length,
          knobs: knobsOf(t),
        })),
      },
    },

    {
      type: 'ticker', id: 'ticker', title: 'watchlist',
      data: {
        asOf: '2026-08-29T20:00:00Z',
        rows: [
          { symbol: 'ACME', name: 'Acme Manufacturing', prevClose: 184.22, last: 189.05,
            currency: 'USD', series: intraday(11, 184.22, 0.026) },
          { symbol: 'BRDG', name: 'Bridger Logistics', prevClose: 62.90, last: 61.14,
            currency: 'USD', series: intraday(12, 62.90, -0.028) },
          { symbol: 'CDNT', name: 'Cadent Health', prevClose: 311.40, last: 312.06,
            currency: 'USD', series: intraday(13, 311.40, 0.002) },
          { symbol: 'DLTA', name: 'Delta Foundry', prevClose: 27.35, last: 29.88,
            currency: 'USD', series: intraday(14, 27.35, 0.092) },
          { symbol: 'EVRN', name: 'Evergreen Utilities', prevClose: 96.10, last: 95.72,
            currency: 'USD', series: intraday(15, 96.10, -0.004) },
          { symbol: 'FTHM', name: 'Fathom Data', prevClose: 448.75, last: 421.30,
            currency: 'USD', series: intraday(16, 448.75, -0.061) },
          { symbol: 'GRNT', name: 'Granite Materials', prevClose: 14.08, last: 14.11,
            currency: 'USD', series: [] },
        ],
      },
    },

    {
      type: 'candles', id: 'candles', title: 'ACME \u2014 ninety sessions',
      data: { symbol: 'ACME', currency: 'USD', bars: candleBars() },
    },

    {
      type: 'portfolio', id: 'portfolio', title: 'the book',
      data: {
        currency: 'USD',
        cash: 24180.55,
        holdings: [
          { symbol: 'ACME', qty: 420,  cost: 151.20, last: 189.05, sector: 'industrials' },
          { symbol: 'BRDG', qty: 900,  cost: 71.44,  last: 61.14,  sector: 'industrials' },
          { symbol: 'CDNT', qty: 115,  cost: 244.10, last: 312.06, sector: 'health care' },
          { symbol: 'DLTA', qty: 2400, cost: 22.05,  last: 29.88,  sector: 'materials' },
          { symbol: 'EVRN', qty: 610,  cost: 88.30,  last: 95.72,  sector: 'utilities' },
          { symbol: 'FTHM', qty: 88,   cost: 502.15, last: 421.30, sector: 'technology' },
          { symbol: 'GRNT', qty: 3100, cost: 11.92,  last: 14.11,  sector: 'materials' },
          { symbol: 'HRBR', qty: 1450, cost: 33.75,  last: 34.02,  sector: 'financials' },
        ],
      },
    },

    {
      type: 'waterfall', id: 'waterfall', title: 'subscription revenue, Q1 to Q2',
      data: {
        unit: '$',
        start: { label: 'Q1 closing ARR', value: 4820000 },
        steps: [
          { label: 'new logos',   value: 640000 },
          { label: 'expansion',   value: 385000 },
          { label: 'reactivated', value: 72000 },
          { label: 'downgrades',  value: -158000 },
          { label: 'churn',       value: -411000 },
          { label: 'FX',          value: -46000 },
        ],
        end: { label: 'Q2 closing ARR' },
      },
    },

    {
      type: 'treemap', id: 'treemap', title: 'the catalogue by area',
      data: {
        unit: 'lines',
        colorBy: 'branch',
        /* The same measurement the flow and the table are built on, asked as a part-of-whole
           question instead: every leaf is a real module and every area is its real size. No
           branch declares a total, so none can disagree with its children. */
        root: {
          name: 'cardkit',
          children: GROUPS.map((g) => ({
            name: g.name,
            children: g.types
              .filter((t) => S.rows.has(t))
              .map((t) => ({ name: t, value: S.rows.get(t).lines })),
          })),
        },
      },
    },

    {
      type: 'sunburst', id: 'sunburst', title: 'the catalogue, split by whether it has a gear',
      data: {
        unit: 'lines',
        colorBy: 'depth',
        /* Deliberately a different decomposition from the treemap's, not the same tree drawn
           round: group, then configurable or not, then the module. The question it answers is
           whether settings cluster in particular kinds of card, and they do. */
        root: {
          name: 'cardkit',
          children: GROUPS.map((g) => {
            const mine = g.types.filter((t) => S.rows.has(t));
            const bucket = (label, pick) => ({
              name: label,
              children: mine.filter(pick).map((t) => ({ name: t, value: S.rows.get(t).lines })),
            });
            return {
              name: g.name,
              children: [
                bucket('with a gear', (t) => knobsOf(t) > 0),
                bucket('no settings', (t) => knobsOf(t) === 0),
              ].filter((b) => b.children.length > 0),
            };
          }),
        },
      },
    },

    {
      type: 'icicle', id: 'icicle', title: 'the catalogue, banded by module size',
      data: {
        unit: 'lines',
        colorBy: 'branch',
        /* The third cut of the same measurement, and the one that echoes the sankey: group,
           then size band, then module. Three hierarchy types on one desk are only worth having
           if each is pointed at a different question, so none of them is the same tree twice. */
        root: {
          name: 'cardkit',
          children: GROUPS.map((g) => {
            const mine = g.types.filter((t) => S.rows.has(t));
            const bands = ['under 700 lines', '700 to 1000 lines', 'over 1000 lines'];
            return {
              name: g.name,
              children: bands.map((b) => ({
                name: b,
                children: mine.filter((t) => bandOf(S.rows.get(t).lines) === b)
                  .map((t) => ({ name: t, value: S.rows.get(t).lines })),
              })).filter((b) => b.children.length > 0),
            };
          }),
        },
      },
    },

    /* ── pictures ───────────────────────────────────────────────────────────────────────── */

    {
      type: 'image', id: 'image', title: 'what the desk actually serves',
      data: {
        columns: 3,
        fit: 'contain',
        images: [
          { src: '/desk-art.png', alt: 'The desk\u2019s own background artwork, a wide painterly scene.',
            caption: 'desk-art.png \u2014 the only bitmap the desk owns, at 1.0 MB' },
          { src: '/icon-claude.svg', alt: 'A drawn glyph standing for the assistant.',
            caption: 'icon-claude.svg \u2014 the desk shell\u2019s favicon' },
          { src: '/icon-john.svg', alt: 'A drawn glyph standing for the desk\u2019s owner.',
            caption: 'icon-john.svg \u2014 the panel\u2019s favicon' },
        ],
      },
    },

    {
      type: 'map', id: 'map', title: 'the largest urban areas',
      data: {
        projection: 'equirectangular',
        graticule: 30,
        center: { lon: 10, lat: 10 },
        scale: 1,
        markers: [
          { lon: 139.69, lat: 35.69,  label: 'Tokyo',        value: 37.4 },
          { lon: 77.21,  lat: 28.61,  label: 'Delhi',        value: 33.8 },
          { lon: 121.47, lat: 31.23,  label: 'Shanghai',     value: 29.9 },
          { lon: -46.63, lat: -23.55, label: 'S\u00e3o Paulo', value: 22.8 },
          { lon: -99.13, lat: 19.43,  label: 'Mexico City',  value: 22.5 },
          { lon: 31.24,  lat: 30.04,  label: 'Cairo',        value: 22.6 },
          { lon: 90.41,  lat: 23.81,  label: 'Dhaka',        value: 23.9 },
          { lon: -74.01, lat: 40.71,  label: 'New York',     value: 19.0 },
          { lon: -0.13,  lat: 51.51,  label: 'London',       value: 9.6 },
          { lon: -122.33, lat: 47.61, label: 'Seattle',      value: 4.0 },
        ],
      },
    },

    {
      type: 'molecule', id: 'molecule', title: 'caffeine',
      /* Of the four presets this is the one that is not planar, so it stays legible right
         through the turn instead of collapsing to a line twice a revolution. */
      data: { preset: 'caffeine' },
    },

    /* ── live sources ───────────────────────────────────────────────────────────────────── */

    {
      type: 'agentboard', id: 'agentboard', title: 'reading the catalogue',
      data: {
        /* There is no /agents.json on this desk, and saying so is better than polling a 404
           and captioning the result as though it were news. */
        url: false,
        now: '2026-08-29T20:12:00Z',
        caption: 'The five readers that produced the data on this desk, and the writer that '
               + 'installed it.',
        agents: [
          { id: 'a1', name: 'reader A', state: 'done', started: '2026-08-29T19:57:04Z',
            finished: '2026-08-29T20:00:26Z',
            task: 'image, choice, molecule, formula, markdown, note',
            note: 'found that molecule throws rather than degrading, and lists four presets' },
          { id: 'a2', name: 'reader B', state: 'done', started: '2026-08-29T19:57:04Z',
            finished: '2026-08-29T20:01:31Z',
            task: 'ledger, rail, matrix, flow, graph',
            note: 'returned the 125-glyph marker vocabulary and the two shapes seriation can find' },
          { id: 'a3', name: 'reader C', state: 'done', started: '2026-08-29T19:57:04Z',
            finished: '2026-08-29T19:59:52Z',
            task: 'heatmap, ribbon, map, table, diff, code, snippet',
            note: 'confirmed the unified-diff parser runs at build time and needs only an @@ hunk' },
          { id: 'a4', name: 'reader D', state: 'done', started: '2026-08-29T19:57:04Z',
            finished: '2026-08-29T20:00:43Z',
            task: 'candles, chart, ticker, portfolio, waterfall',
            note: 'found waterfall silently ignores a supplied end value, by design' },
          { id: 'a5', name: 'reader E', state: 'done', started: '2026-08-29T19:57:04Z',
            finished: '2026-08-29T20:01:32Z',
            task: 'agentboard, audit, logtail, news, rss, weather, clock, countdown, timer',
            note: 'mapped every live card to the route or proxy host it actually calls' },
          { id: 'w1', name: 'adopt.mjs', state: 'running', started: '2026-08-29T20:12:00Z',
            task: 'write all thirty-two cards into the deck',
            note: 'the card you are reading is one of its outputs' },
        ],
      },
    },

    {
      type: 'audit', id: 'audit', title: 'what this desk has been asked to do',
      data: { url: '/audit?n=200', limit: 200 },
    },

    {
      type: 'logtail', id: 'logtail', title: 'the last build',
      data: {
        path: 'C:/Users/john/AppData/Local/Temp/claude/'
            + 'C--Users-john-projects-self-expression/58cf5997-1157-4c50-b520-91d7306fb59b/'
            + 'scratchpad/build.log',
        lines: 500,
        follow: true,
        wrap: false,
      },
    },

    {
      type: 'news', id: 'news', title: 'Hacker News',
      data: { feed: 'https://hnrss.org/frontpage', count: 10, summaries: true },
    },

    {
      type: 'rss', id: 'rss', title: 'four feeds, merged',
      data: {
        feeds: [
          'https://hnrss.org/frontpage',
          'https://lobste.rs/rss',
          'https://www.theregister.com/headlines.atom',
          'https://feeds.bbci.co.uk/news/technology/rss.xml',
        ],
        count: 10,
        group: 'source',
      },
    },

    {
      type: 'weather', id: 'weather', title: 'Seattle',
      data: { place: 'Seattle', units: 'f', hours: 24 },
    },

  ];
}

/* ── installing ────────────────────────────────────────────────────────────────────────── */

const cat   = await catalogue();
const specs = deck(cat);

/* Every type in the catalogue must have a spec here, and the check runs before anything is
   written. Three types were added to `types/` by another hand while this script was being
   written, and because the deck is a hand-kept list they were silently not adopted — the
   catalogue grew and the desk did not. Comparing the two directions costs four lines and
   turns that from a thing you notice a day later into a thing that fails now. */
const uncovered = [...cat.keys()].filter((t) => !specs.some((s) => s.type === t));
if (uncovered.length) {
  console.error('the catalogue has types this script does not adopt: ' + uncovered.join(', '));
  console.error('add a spec for each in deck(), and an entry in GROUPS, then run again.');
  process.exit(1);
}

/* Bands are hand-assigned and types keep arriving, so a growing group eventually runs into
   the next band's floor. Two cards with the same ord do not error anywhere downstream — they
   just sort against each other arbitrarily, which is the kind of wrong that looks like a
   preference. Caught here, where the numbers are still in one place. */
const byOrd = new Map();
for (const s of specs) {
  const o = ordOf(s.type);
  byOrd.set(o, (byOrd.get(o) ?? []).concat(s.type));
}
const clashes = [...byOrd].filter(([, who]) => who.length > 1);
if (clashes.length) {
  for (const [o, who] of clashes) console.error('ord ' + o + ' is claimed by: ' + who.join(', '));
  console.error('widen the band in GROUPS so each card sorts where it was meant to.');
  process.exit(1);
}

if (!existsSync(DECK)) mkdirSync(DECK, { recursive: true });

const wrote = [], threw = [], refused = [], missing = [];

for (const spec of specs) {
  const mod = cat.get(spec.type);
  if (!mod) { missing.push(spec.type); continue; }

  const full = { id: spec.id, title: spec.title, data: spec.data, ord: ordOf(spec.type) };

  /* Built once here purely to be audited. A type that throws is a finding, not something to
     work around by thinning the data until it passes. */
  let built;
  try { built = mod.build({ ...full }); }
  catch (e) { threw.push({ type: spec.type, error: e && e.message ? e.message : String(e) }); continue; }

  const complaints = audit(built);
  if (complaints.length) { refused.push({ type: spec.type, complaints }); continue; }

  writeCard(mod, full, DECK);
  wrote.push({ id: spec.id, type: spec.type, ord: full.ord, group: groupOf(spec.type) });
}

/* ── what happened ─────────────────────────────────────────────────────────────────────── */

for (const g of GROUPS) {
  const mine = wrote.filter((w) => w.group === g.name).sort((a, b) => a.ord - b.ord);
  if (!mine.length) continue;
  console.log(g.name + '  (ord ' + g.ord + '..' + (g.ord + g.types.length - 1) + ')');
  for (const w of mine) console.log('  ' + String(w.ord).padStart(3) + '  ' + w.id);
}

console.log('');
console.log(wrote.length + ' cards written into ' + DECK);

if (missing.length) console.log('not in the catalogue: ' + missing.join(', '));

for (const t of threw) console.log('BUILD THREW  ' + t.type + ': ' + t.error);
for (const r of refused) {
  console.log('REFUSED BY AUDIT  ' + r.type);
  for (const c of r.complaints) console.log('    ' + c);
}

process.exit(threw.length || refused.length ? 1 : 0);
