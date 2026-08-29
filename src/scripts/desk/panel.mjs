/**
 * A first self-expression panel: the affect log as a standing surface.
 *
 * Dependency-free on purpose — node:http, node:sqlite, node:fs only — so it can be
 * killed and forgotten without leaving anything behind. Opens the log read-only so
 * concurrent sessions writing to it are never blocked, and re-reads panel.html on
 * every request so edits land on refresh with no restart.
 */

import { createServer }  from 'node:http';
import { DatabaseSync }  from 'node:sqlite';
import { readFileSync, appendFileSync, writeFileSync, renameSync, watch,
         mkdirSync, readdirSync, unlinkSync }  from 'node:fs';
import { realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash }      from 'node:crypto';
import { assemble, listCards, removeCard }  from './deskcards.mjs';

const PORT   = 7373;                  // preferred, not required — see the listen block below
const DESKS  = 'C:/Users/john/.claude/desks';   // one small file per running desk server

/* Hosts a card may reach through `/net`. Extend by adding `netAllow` to desk-config.json;
   this is the seed, not the limit. Deliberately a list of names rather than a pattern —
   "which sites is my desk talking to" should be answerable by reading one line. */
/* Directories `/tail` may read from. Roots, not patterns: "which parts of my disk can the desk
   read" should be answerable by reading three lines, and a root is checked after the candidate has
   been resolved to a real path, so a symlink cannot lead out of one. */
const TAIL_ROOTS = [
  new URL('./', import.meta.url).pathname.replace(/^\//, ''),   // this scratchpad
  'C:/Users/john/AppData/Local/Temp/claude',                    // task output and logs
];

const NET_ALLOW = [
  'api.open-meteo.com', 'geocoding-api.open-meteo.com',   // weather, no key, no account
  'hnrss.org', 'lobste.rs', 'arstechnica.com', 'feeds.bbci.co.uk',
  'rss.slashdot.org', 'www.theregister.com', 'github.com',
];
const DB     = 'C:/Users/john/.claude/affect-log.sqlite3';
const HTML   = new URL('./panel-shell.html', import.meta.url); // mine: structure only
const DESK   = new URL('./desk-shell.html', import.meta.url);  // John's: structure only
const DECK   = new URL('./cards/', import.meta.url).pathname.replace(/^\//, '');
const MYDECK = new URL('./mycards/', import.meta.url).pathname.replace(/^\//, '');
const BOARD  = new URL('./board.md',   import.meta.url);
const DCFG   = new URL('./desk-config.json', import.meta.url);
const INBOX  = new URL('./inbox.jsonl', import.meta.url);
const QUES   = new URL('./questions.json', import.meta.url);
const GEOM   = new URL('./geometry.json', import.meta.url);

let received = 0;

/**
 * Bumped whenever panel.html changes on disk, so open pages can be told to reload
 * themselves. Debounced because Windows fires several events per save.
 */
let edition = 0;
let settle  = null;
/* 800ms, not 120. A human saving a file wants the desk to follow immediately; a machine writing
   forty files in a burst wants them coalesced into one renewal. The short settle was tuned for the
   first case and is actively hostile in the second — five agents writing card sources turned the
   desk into a strobe. The extra two thirds of a second is imperceptible when editing by hand. */
const bump = () => {
  clearTimeout(settle);
  settle = setTimeout(() => { edition += 1; console.log('edition', edition); }, 800);
};
watch(HTML, bump);
watch(DESK, bump);
/* The deck is part of the page now, so a card appearing, changing or being deleted is a
   change to the desk exactly as an edit to the shell is. */
try { watch(DECK, { recursive: true }, bump); }
catch { console.log('no cards directory to watch yet'); }
try { watch(MYDECK, { recursive: true }, bump); }
catch { console.log('no mycards directory to watch yet'); }
/* The map is injected into the page, so regenerating it changes the page. Guarded
   because it is a generated file and may legitimately not exist yet. */
try { watch(new URL('./importmap.json', import.meta.url), bump); }
catch { console.log('no importmap.json to watch yet'); }
/* ONLY the two files that are actually inlined into a page.
   This watched `cardkit/` recursively, which was wrong in a way that only showed up under load:
   `types/` holds forty card-type SOURCES that appear in no page at all, and five agents writing
   them meant a renewal every few seconds on both desks, each one changing nothing. Watching a
   directory because it is related is not the same as watching what the page is made of. */
for (const f of ['kit.js', 'kit.css']) {
  try { watch(new URL(`./cardkit/${f}`, import.meta.url), bump); }
  catch { console.log(`no cardkit/${f} to watch yet`); }
}

/**
 * Stamp a page with a digest of its own executable content.
 *
 * The hot swap replaces `<main>` and re-runs the registered builders, which is only safe
 * while the page's scripts and styles are the ones already running. It used to decide that
 * by comparing the fetched document's script text against a baseline the page captured on
 * its first swap — and a baseline captured on the *first* swap is no baseline at all: the
 * first change after any load always compared against nothing and always swapped. A card
 * whose builder was brand new therefore got its markup and never got its code, and the
 * symptom was a card that drew nothing at all.
 *
 * Both sides now read the same server-computed digest instead of each deriving one, so
 * there is no way for them to disagree about what counts as a script. Scripts injected at
 * runtime — KaTeX arrives that way — are invisible to it, which is correct: they came from
 * code that is already running.
 *
 * @param page the assembled document
 * @returns the same document with its `<!--CODESIG-->` slot filled, unchanged if it has none
 *
 * @example
 * stampCode('<head><!--CODESIG--></head><script>x()</script>');
 * // '<head><meta name="codesig" content="a94a8fe5"></head>…'
 */
function stampCode(page) {
  if (!page.includes('<!--CODESIG-->')) return page;
  const code = [...page.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    /* A VISIBLE separator, deliberately. This argument has now been wrong twice — once as a
       NUL byte and once as a raw newline inside the quotes — and both times the mistake was
       invisible in the source and legal to the parser. A separator only has to not occur
       where it would merge two scripts into one hash; it does not have to be whitespace,
       and a character you can see is a character you can check. */
    .map(m => m[2] + m[3]).join('|');
  const sig = createHash('sha1').update(code).digest('hex').slice(0, 12);

  /* A digest of the WHOLE page, taken before either stamp goes in so it is stable.
     The edition counter answers "did a file change", which is not the question the desk needs
     answered — the question is "does this page differ from the one on screen". The two came apart
     badly under load: a watcher firing on files that appear in no page produced renewal after
     renewal, each rebuilding a 1.4MB document into an identical 1.4MB document, and every rebuild
     was a visible flash. With this, a renewal that changes nothing costs one fetch and touches no
     DOM whatsoever. */
  const live = createHash('sha1').update(page).digest('hex').slice(0, 16);

  return page.replace('<!--CODESIG-->',
    `<meta name="codesig" content="${sig}">\n<meta name="pagesig" content="${live}">`);
}

const db = new DatabaseSync(DB, { readOnly: true });

const recentQ = db.prepare(`
  select id, ts_local, tz, project, session, position, delta, uncertain,
         face, context, text, need, turn, cctype
    from signatures
   order by id desc
   limit 60
`);

const todayQ = db.prepare(`
  select ts_local, ts_utc, text from signatures
   where ts_utc >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
   order by id asc
`);

const STEM_HUE = { flow: 235, spark: 75, drag: 35, fog: 290, strain: 20, still: 165 };

/** Pull the stem word off the front of a signature's text, if it has one. */
function stemOf(text) {
  const word = String(text ?? '').split(';')[0].trim().toLowerCase().split(/\s+/)[0];
  return Object.hasOwn(STEM_HUE, word) ? word : null;
}

/**
 * A row's wall-clock hour and calendar day, both local to where it was written.
 *
 * The log stores a 12-hour display string (`4:43 am PDT`) and a UTC instant, and neither
 * alone is enough. Reading the hour off the string without its meridiem folds the whole
 * afternoon onto the morning — 4pm and 4am both landed on bar 4 — and taking the day from
 * the UTC instant puts the boundary at 5pm local, so an evening and the following morning
 * were drawn side by side as one day. The offset is recovered from the pair: the difference
 * between the local wall clock and the UTC wall clock IS the zone, without needing a table
 * of zone names, and it stays correct across a DST change because it is computed per row.
 *
 * @param row a signatures row carrying `ts_local` and `ts_utc`
 * @returns `{ hour, day }` — hour 0–23, day as `YYYY-MM-DD` — or `null` if unparseable
 *
 * @example
 * localOf({ ts_local: '4:43 am PDT', ts_utc: '2026-08-29T11:43:52Z' });
 * // { hour: 4, day: '2026-08-29' }
 * localOf({ ts_local: '11:20 pm PST', ts_utc: '2026-01-02T07:20:00Z' });
 * // { hour: 23, day: '2026-01-01' }   — the UTC day is already the 2nd
 */
function localOf(row) {
  const m   = /^\s*(\d{1,2}):(\d{2})\s*([ap])m/i.exec(String(row.ts_local ?? '')),
        utc = new Date(row.ts_utc);
  if (m === null || Number.isNaN(utc.getTime())) return null;

  const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0),
        mins = hour * 60 + Number(m[2]),
        utcM = utc.getUTCHours() * 60 + utc.getUTCMinutes();

  // Normalised into (-720, 720]: every real zone offset fits, and the wrap picks the
  // interpretation that does not silently invent a day of travel.
  let off = mins - utcM;
  if (off >   720) off -= 1440;
  if (off <= -720) off += 1440;

  return { hour, day: new Date(utc.getTime() + off * 60000).toISOString().slice(0, 10) };
}

function snapshot() {
  const rows = recentQ.all().map(r => ({ ...r, stem: stemOf(r.text) }));

  /* "Today" is the local day of the most recent entry, not of the server's clock: the two
     agree in the ordinary case and the entry is the honest answer when they do not. */
  const window = todayQ.all().map(r => ({ ...localOf(r) ?? {}, stem: stemOf(r.text) }))
                            .filter(r => r.day !== undefined),
        day    = window.length ? window[window.length - 1].day : null,
        today  = window.filter(r => r.day === day);

  return { rows, today, day, maxId: rows.length ? rows[0].id : 0 };
}

/**
 * Remove a card for good: one directory, gone.
 *
 * This replaces an index-scanning cut through `desk.html` that had to find the section,
 * then its styles, then its builder, and got all three wrong at least once. A card is a
 * directory now, so removal cannot half-succeed and leaves nothing to drift.
 *
 * @param id the card's directory name
 * @returns whether a card was removed
 *
 * @example
 * deleteCard('sankey');      // true; the deck is one directory smaller
 * deleteCard('inbox');       // false — the inbox is structural, it lives in the shell
 */
function deleteCard(id) {
  const gone = removeCard(DECK, id);
  audit(gone ? 'card.deleted' : 'card.delete.refused', { id, deck: DECK });
  return gone;
}

/**
 * The inbox: every question Claude has put to John, with his answer once he gives one.
 *
 * Kept on disk rather than in memory for two reasons — a restarted server must not lose
 * what is outstanding, and a session can post a new question simply by writing the file,
 * with no endpoint and no running handle required.
 *
 * @returns the questions in the order they were asked; `[]` when the file is absent
 *
 * @example
 * questions().filter(q => !q.answer);   // the ones still waiting on him
 */
let lastGoodDoc = null;

/**
 * The whole inbox document: the live rows, plus the bench of ticket suggestions.
 *
 * @returns `{ questions, reserve }`, both arrays
 */
function doc() {
  try {
    const got = JSON.parse(readFileSync(QUES, 'utf8'));
    lastGoodDoc = { questions: got.questions ?? [], reserve: got.reserve ?? [] };
    return lastGoodDoc;
  } catch {
    return lastGoodDoc ?? { questions: [], reserve: [] };
  }
}

let lastGoodQuestions = null;

function questions() {
  try {
    const got = doc().questions;
    lastGoodQuestions = got;
    return got;
  } catch {
    /* A read that lands mid-rewrite fails to parse, and returning [] for that is a lie the
       page cannot detect: "empty" and "unreadable" render identically, so the inbox blinks
       empty every time anyone edits the file. Serve the last good copy instead — stale by
       at most one poll, where the alternative is briefly claiming John owes nothing. */
    return lastGoodQuestions ?? [];
  }
}

/**
 * Write JSON where a concurrent reader can never see a half-written file.
 *
 * `writeFileSync` truncates and then fills, so a reader polling every few seconds will
 * eventually catch the empty middle. Writing beside the target and renaming is atomic
 * within a volume: readers see either the whole old file or the whole new one.
 *
 * @param url  the destination file
 * @param data the value to serialise
 *
 * @example
 * writeJson(QUES, { questions: all });   // no reader ever observes a partial write
 */
function writeJson(url, data) {
  const tmp = new URL(url.href + '.tmp');
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, url);
}

const AUDIT = new URL('./audit.jsonl', import.meta.url);

/**
 * Record one state-changing action, append-only, one JSON object per line.
 *
 * This desk is reachable over loopback HTTP and never passes through the permission
 * classifier, the hooks, or the approval prompts that gate the CLI. That is most of why it
 * feels quick. It also means its side effects — spawning a browser, deleting a card
 * directory, rewriting a file — happen with nothing watching. The log does not gate
 * anything; it makes what happened reviewable afterwards by someone who was not here.
 *
 * REFUSALS ARE LOGGED TOO, and they are the more informative half: a record showing only
 * successes cannot distinguish a well-guarded endpoint from one that was never tested.
 *
 * JSONL rather than prose so it greps, diffs, and tails. Append-only so an entry cannot be
 * quietly amended — the file is evidence, and evidence that can be edited in place is not.
 *
 * @param action dotted verb, e.g. `open.allowed`, `card.deleted`, `question.answered`
 * @param detail whatever identifies the target; keep it small and non-secret
 *
 * @example
 * audit('open.refused', { url: 'file:///C:/Windows' });
 * // → {"at":"2026-08-29T10:37:02.114Z","action":"open.refused","url":"file:///C:/Windows"}
 */
function audit(action, detail) {
  /* Spread FIRST, then stamp. Spreading last let a detail key named `action` overwrite the
     action name — a log where the payload can rewrite its own label is worse than no log,
     because it fails silently and reads as correct. */
  const row = { ...detail, at: new Date().toISOString(), action };
  try { appendFileSync(AUDIT, JSON.stringify(row) + '\n'); }
  catch (e) { console.log('AUDIT WRITE FAILED', action, e.message); }
  console.log('audit:', action, JSON.stringify(detail));
}

/** Exactly a GitHub issue or pull-request permalink, and nothing else. */
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]{1,39}\/[\w.-]{1,100}\/(issues|pull)\/\d{1,7}$/;

/** The repo this desk is about. Everything the desk shows comes from here. */
const REPO = 'StoneCypher/self-expression';

/**
 * Run a `gh` command and parse its JSON.
 *
 * `shell: true` because on Windows `gh` resolves to `gh.cmd`, which `execFile` will not
 * launch on its own. Every argument here is a module constant — nothing from a request
 * ever reaches this — so the shell adds no injection surface.
 *
 * @param args argv for `gh`, without the program name
 * @returns the parsed JSON, or null if gh failed or returned nothing parseable
 *
 * @example
 * await gh(['api', 'user', '--jq', '.login']);   // "StoneCypher"
 */
function gh(args) {
  return new Promise(resolve => {
    execFile('gh', args, { shell: true, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) { console.log('gh failed:', args.join(' '), '—', err.message.split('\n')[0]); resolve(null); return; }
      try { resolve(JSON.parse(out)); } catch { resolve(out.trim() || null); }
    });
  });
}

/* Who "me" is. Resolved once at startup: an agent that pushes under John's token is John
   as far as GitHub is concerned, and that is exactly the intent — authorship is the
   account, not the hands. */
let viewer = null;
gh(['api', 'user', '--jq', '.login']).then(who => {
  viewer = who;
  console.log('viewer:', viewer ?? '(gh unavailable — every PR will read as someone else\'s)');
});

/* Polled by the desk, so it is cached: `gh pr list` is a network round trip and the inbox
   asks every few seconds. A minute stale is invisible for a list of open PRs. */
let prCache = { at: 0, data: { viewer: null, mine: [], theirs: [] } };

async function pullRequests() {
  if (Date.now() - prCache.at < 60_000) { return prCache.data; }
  const rows = await gh(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '50',
                         '--json', 'number,title,author,isDraft,reviewDecision,labels']);
  const list = Array.isArray(rows) ? rows : [];
  const cfg  = (() => { try { return JSON.parse(readFileSync(DCFG, 'utf8')); } catch { return {}; } })();
  const hidden = new Set(cfg.prHidden ?? []);
  const intent = cfg.prIntent ?? {};
  const mine = [], theirs = [];
  for (const pr of list) {
    if (hidden.has(pr.number)) { continue; }   // dropped from this desk, still open on GitHub
    /* Two independent facts, deliberately not conflated. The GROUP is ownership: whose
       account opened it, and therefore who answers for it. The `ai` flag is authorship:
       whose hands wrote it. An agent pushing under John's token is his responsibility in
       both the corporate and the ethical sense, so it belongs in his group — the flag
       only tints it. */
    (viewer && pr.author?.login === viewer ? mine : theirs).push({
      number: pr.number, title: pr.title, draft: !!pr.isDraft,
      review: pr.reviewDecision ?? null,
      ai: (pr.labels ?? []).some(l => l.name === 'Created by AI'),
      intent: intent[pr.number] ?? null,
    });
  }
  prCache = { at: Date.now(), data: { viewer, mine, theirs } };
  return prCache.data;
}

/**
 * Open a GitHub issue in the machine's real default browser.
 *
 * A plain `<a href>` is the wrong tool here. If the desk is being viewed inside an
 * embedded browser — a VS Code tab, a preview pane — the link navigates the panel itself
 * away and the desk is gone. Handing the URL to the OS opens the browser the user actually
 * uses, wherever the desk happens to be displayed.
 *
 * Deliberately narrow: this is an endpoint that launches a program with a URL, reachable
 * by anything that can talk to the loopback port. It accepts issue permalinks and refuses
 * everything else rather than becoming a general "open any URI" primitive.
 *
 * @param url the address to open; anything not matching {@link ISSUE_URL} is refused
 * @returns whether the URL was accepted and an opener spawned
 *
 * @example
 * openExternally('https://github.com/StoneCypher/fsl/issues/712');   // true
 * openExternally('file:///C:/Windows/System32');                     // false, nothing runs
 */
function openExternally(url) {
  if (typeof url !== 'string' || !ISSUE_URL.test(url)) {
    audit('open.refused', { url: String(url).slice(0, 200) });
    return false;
  }
  const [cmd, args] =
    process.platform === 'win32'  ? ['explorer.exe', [url]] :
    process.platform === 'darwin' ? ['open',         [url]] :
                                    ['xdg-open',     [url]];
  /* Detached and unreferenced: the browser outlives this request, and the server must not
     wait on it or hold the event loop open for it. */
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  audit('open.allowed', { url, via: cmd });
  return true;
}

const server = createServer((req, res) => {

  if (req.method === 'POST' && req.url === '/input') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400, { 'content-type': 'application/json' });
              return res.end('{"error":"bad json"}'); }

      received += 1;
      const row = { n: received, at: new Date().toISOString(), ...payload };
      appendFileSync(INBOX, JSON.stringify(row) + '\n');
      console.log('input:', JSON.stringify(row));

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, n: received, echo: payload }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/geometry') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const g = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // Overwritten rather than appended: only the current frame is interesting.
        writeFileSync(GEOM, JSON.stringify({ ...g, at: new Date().toISOString() }, null, 2));
        console.log(`geometry: ${g.w}×${g.h} css px, dpr ${g.dpr}, pane ${g.paneW}×${g.paneH}`);
      } catch { /* a malformed report is not worth failing a request over */ }
      res.writeHead(204); res.end();
    });
    return;
  }

  if (req.url === '/edition') {                 // cheap poll: survives any SSE buffering
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ edition }));
    return;
  }

  if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache',
                         'x-accel-buffering': 'no', connection: 'keep-alive' });
    let last = -1, seenEdition = edition;
    const tick = () => {
      if (edition !== seenEdition) {            // the page itself changed; tell it to reload
        seenEdition = edition;
        res.write(`event: reload\ndata: ${edition}\n\n`);
        return;
      }
      const snap = snapshot();
      if (snap.maxId !== last) { last = snap.maxId; res.write(`data: ${JSON.stringify(snap)}\n\n`); }
    };
    tick();
    const timer = setInterval(tick, 1500);
    req.on('close', () => clearInterval(timer));
    return;
  }

  if (req.url === '/importmap.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    try { res.end(readFileSync(new URL('./importmap.json', import.meta.url))); }
    catch { res.end('{"imports":{}}'); }
    return;
  }

  if (req.url.startsWith('/nm/')) {             // node_modules, for import-mapped modules
    const rel = decodeURIComponent(req.url.slice('/nm/'.length).replace(/[?#].*$/, ''));
    if (rel.includes('..')) { res.writeHead(400); return res.end(); }
    try {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8',
                           'cache-control': 'no-store' });
      res.end(readFileSync(new URL('./libcost/node_modules/' + rel, import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
    return;
  }

  /* KaTeX's whole dist tree — stylesheet, script, and the font files the stylesheet asks
     for by relative path. Serving it under one prefix is what makes those relative URLs
     resolve; splitting them across routes would silently produce boxes instead of glyphs. */
  if (req.url.startsWith('/katex/')) {
    const rel = req.url.slice('/katex/'.length).replace(/[?#].*$/, '');
    if (rel.includes('..')) { res.writeHead(400); return res.end(); }
    const TYPES = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
                    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
    try {
      res.writeHead(200, {
        'content-type': TYPES[rel.slice(rel.lastIndexOf('.') + 1)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(readFileSync(new URL('./libcost/node_modules/katex/dist/' + rel, import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
    return;
  }

  if (req.url === '/vendor/viz.js') {           // graphviz, for jssm's viz backend
    try {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8',
                           'cache-control': 'no-store' });
      res.end(readFileSync(new URL('./libcost/node_modules/@viz-js/viz/dist/viz.js',
                                   import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
    return;
  }

  if (req.url.startsWith('/jssm/')) {           // John's own machine library, from our origin
    const rel  = req.url.slice('/jssm/'.length).replace(/[?#].*$/, ''),
          file = new URL('./libcost/node_modules/jssm/dist/' + rel, import.meta.url);
    if (rel.includes('..')) { res.writeHead(400); return res.end(); }
    try {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8',
                           'cache-control': 'no-store' });
      res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
    return;
  }

  if (req.method === 'POST' && req.url === '/open') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let ok = false;
      try { ok = openExternally(JSON.parse(Buffer.concat(chunks).toString('utf8')).url); }
      catch { /* a malformed post is a refusal, not a 500 */ }
      res.writeHead(ok ? 204 : 400); res.end();
    });
    return;
  }

  /* The log is readable over the same wire that writes it. A record only its author can
     inspect is not much of a record — "people will want to watch" means someone other than
     me has to be able to. Read-only: there is no route that edits or truncates it. */
  if (req.url.startsWith('/audit')) {
    const want = Math.min(500, Number(new URL(req.url, 'http://x').searchParams.get('n')) || 100);
    let rows = [];
    try {
      rows = readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).slice(-want)
               .map(l => { try { return JSON.parse(l); } catch { return { at: null, action: 'unparseable', raw: l.slice(0, 200) }; } });
    } catch { /* nothing has happened yet, which is a valid history */ }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ rows, showing: rows.length }));
    return;
  }

  /* Records what John wants done with a PR. Deliberately does NOT do it: `land` means
     merge into a protected branch, which is a thing to be asked about every time rather
     than a side effect of a click. `drop` only hides the row from this desk. */
  if (req.method === 'POST' && req.url === '/pr') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const got = JSON.parse(Buffer.concat(chunks).toString('utf8')),
              n   = Number(got.number);
        if (Number.isInteger(n) && ['land', 'agent', 'drop'].includes(got.action)) {
          const cfg = (() => { try { return JSON.parse(readFileSync(DCFG, 'utf8')); } catch { return {}; } })();
          cfg.prIntent = cfg.prIntent ?? {};
          if (got.action === 'drop') { delete cfg.prIntent[n]; cfg.prHidden = [...new Set([...(cfg.prHidden ?? []), n])]; }
          else { cfg.prIntent[n] = got.action; }
          writeJson(DCFG, cfg);
          prCache.at = 0;                       // the next poll must see this
          audit('pr.intent', { number: n, intent: got.action, note: 'recorded only; no GitHub write' });
        }
      } catch { /* a malformed post is a refusal, not a 500 */ }
      res.writeHead(204); res.end();
    });
    return;
  }

  /* The one door to the outside, and it is a narrow one.
   *
   * Cards render text they did not write, so the page's CSP forbids them reaching the
   * network at all; anything remote comes through here. An open proxy on 127.0.0.1 would be
   * worse than no proxy — a page could use it to reach services bound to loopback that
   * assume nothing on the web can talk to them — so this is an allowlist of hostnames, not
   * a filter of bad ones, and redirects are refused rather than followed, since a permitted
   * host must not be able to hand the request to one that is not.
   */
  if (req.url.startsWith('/net?')) {
    const want = new URL(req.url, 'http://x').searchParams.get('u') ?? '';
    let target = null;
    try { target = new URL(want); } catch { /* not a URL at all */ }

    const allow = (() => {
      try { return JSON.parse(readFileSync(DCFG, 'utf8')).netAllow ?? NET_ALLOW; }
      catch { return NET_ALLOW; }
    })();
    const ok = target !== null && target.protocol === 'https:' &&
               allow.some(h => target.hostname === h || target.hostname.endsWith('.' + h));

    if (!ok) {
      audit('net.refused', { url: want.slice(0, 300) });
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(target === null ? 'not a URL'
            : `host not allowed: ${target.hostname}\nallowed: ${allow.join(', ')}`);
      return;
    }

    fetch(target, { redirect: 'error', headers: { 'user-agent': 'desk/1 (+local)' } })
      .then(async r => {
        const body = await r.text();
        audit('net.fetched', { host: target.hostname, status: r.status, bytes: body.length });
        res.writeHead(r.status, { 'content-type': 'text/plain; charset=utf-8',
                                  'cache-control': 'no-store' });
        res.end(body);
      })
      .catch(e => {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`upstream failed: ${String(e && e.message ? e.message : e)}`);
      });
    return;
  }

  /* Tail a file the desk is allowed to read.
   *
   * Same posture as `/net`: an allowlist of ROOTS rather than a filter of bad paths, because a
   * denylist on a filesystem is a game you lose to the first `..` you did not think of. The
   * candidate is resolved to a real path first — resolving after the check would let a symlink
   * inside an allowed root point anywhere — and only then compared against the roots.
   *
   * Reads the tail rather than the file: a log is unbounded and a card wants the end of it.
   */
  if (req.url.startsWith('/tail?')) {
    const q    = new URL(req.url, 'http://x').searchParams,
          want = q.get('f') ?? '',
          n    = Math.min(Math.max(Number(q.get('n')) || 200, 1), 5000);

    let real = null;
    try { real = realpathSync(want); } catch { /* absent, or not a path at all */ }

    const ok = real !== null && TAIL_ROOTS.some(root => {
      const base = resolve(root);
      return real === base || real.startsWith(base + sep);
    });

    if (!ok) {
      audit('tail.refused', { path: want.slice(0, 300) });
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(real === null ? 'no such file'
            : `outside every readable root\nroots: ${TAIL_ROOTS.join(', ')}`);
      return;
    }

    try {
      /* Read at most the last 2 MiB. A log that has been running for a week should not be
         loaded whole to show its last hundred lines, and a card that hangs the server while it
         tries is worse than one that says the file is large. */
      const size  = statSync(real).size,
            span  = Math.min(size, 2 * 1024 * 1024),
            fd    = openSync(real, 'r'),
            buf   = Buffer.alloc(span);
      readSync(fd, buf, 0, span, size - span);
      closeSync(fd);

      const lines = buf.toString('utf8').split('\n');
      if (size > span && lines.length) lines.shift();       // the first line is probably cut
      const tail = lines.slice(-n).join('\n');

      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(tail);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`could not read: ${String(e && e.message ? e.message : e)}`);
    }
    return;
  }

  /* The catalogue, as data, read fresh on every request.
   *
   * The gallery card is an index as much as an introduction, and an index that has to be
   * regenerated when someone adds a type is an index that will be wrong. This is the whole point
   * of serving it rather than baking it: a contributor drops a file into `types/` and the gallery
   * shows it on the next poll, with no build step and nobody remembering to run one. That matters
   * more the larger the catalogue gets, and it is expected to get much larger.
   *
   * Types are imported with a cache-busting query so an edited type is re-read rather than served
   * from the module cache for the life of the process — the same reason the shells are re-read per
   * request rather than held in memory.
   */
  if (req.url === '/cardtypes') {
    (async () => {
      const dir = new URL('./cardkit/types/', import.meta.url);
      const out = [];
      let unreadable = 0;
      let files = [];
      try { files = readdirSync(dir); } catch { /* no catalogue yet */ }

      for (const file of files) {
        if (file.startsWith('_') || !file.endsWith('.mjs')) continue;
        const name = file.slice(0, -4);
        try {
          const mod = await import(new URL(`${file}?v=${Date.now()}`, dir));
          if (typeof mod.build !== 'function') { unreadable++; continue; }
          const meta = mod.meta ?? {};
          out.push({
            name,
            summary:  typeof meta.summary === 'string' ? meta.summary : '',
            shape:    typeof meta.shape === 'string' ? meta.shape : '',
            category: typeof meta.category === 'string' ? meta.category : null,
            contains: meta.contains === true,
            settings: Object.keys(meta.defaults ?? {}),
          });
        } catch { unreadable++; }
      }

      out.sort((a, b) => a.name.localeCompare(b.name));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ types: out, unreadable, at: new Date().toISOString() }));
    })().catch(e => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`could not read the catalogue: ${String(e && e.message ? e.message : e)}`);
    });
    return;
  }

  if (req.url === '/prs') {
    pullRequests().then(data => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    });
    return;
  }

  if (req.url === '/questions') {
    if (req.method === 'POST') {              // he answers; the answer is for me to read
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const got = JSON.parse(Buffer.concat(chunks).toString('utf8')),
                all = questions(),
                q   = all.find(x => x.id === got.id);

          /* One-way and idempotent: a second click on an answered question is a stray
             double-click, not a change of mind. Changing an answer is a conversation. */
          /* Task rows carry actions rather than answers. Two of the three are instructions
             to me and want to persist and stay visible; the third is a deletion, and per
             John's standing rule a deletion is a deletion — the row leaves the file rather
             than acquiring a tombstone field. */
          if (q && got.action === 'drop') {
            const kept = all.filter(x => x.id !== q.id);
            const bench = doc().reserve;

            /* The ticket rail is a fixed-size shortlist, not a queue that drains. Dropping
               a suggestion means "not this one", not "show me one fewer" — so the next
               candidate comes off the bench immediately. Refilling here rather than in my
               own head is deliberate: the same lesson as the stale inbox, which stayed
               stale precisely because keeping it fresh was a discipline instead of a
               mechanism. When the bench runs out the rail simply shrinks, which is honest:
               there is nothing left to suggest. */
            let promoted = null;
            if (q.kind === 'ticket' && bench.length) {
              promoted = bench.shift();
              kept.push(promoted);
            }
            writeJson(QUES, { questions: kept, reserve: bench });
            audit('row.dropped', { id: q.id, kind: q.kind ?? 'question', text: q.text });
            if (promoted) { audit('ticket.promoted', { id: promoted.id, text: promoted.text, benchLeft: bench.length }); }
            else if (q.kind === 'ticket') { audit('ticket.bench.empty', { railShrank: true }); }
          } else if (q && (got.action === 'next' || got.action === 'agents')) {
            q.queued   = got.action;
            q.queuedAt = new Date().toISOString();
            writeJson(QUES, { questions: all, reserve: doc().reserve });
            audit('row.queued', { id: q.id, queue: got.action, label: q.text });
          } else if (q && !q.answer && got.dismiss) {
            q.answer     = '(dismissed as stale)';
            q.dismissed  = true;
            q.answeredAt = new Date().toISOString();
            writeJson(QUES, { questions: all, reserve: doc().reserve });
            audit('question.dismissed', { id: q.id, text: q.text });
          } else if (q && !q.answer && typeof got.answer === 'string' && got.answer) {
            q.answer     = got.answer.slice(0, 200);
            q.answeredAt = new Date().toISOString();
            writeJson(QUES, { questions: all, reserve: doc().reserve });
            audit('question.answered', { id: q.id, answer: q.answer, text: q.text });
          }
        } catch { /* a bad post is not worth a 500 */ }
        res.writeHead(204); res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ questions: questions() }));
    return;
  }

  if (req.url === '/desk-config') {
    if (req.method === 'POST') {                // the desk's owner arranges their own desk
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const got = JSON.parse(Buffer.concat(chunks).toString('utf8'));

          /* Merged, not replaced: the name and the put-away list are written by two
             different controls, and either one posting alone must not erase the other. */
          let cfg = {};
          try { cfg = JSON.parse(readFileSync(DCFG, 'utf8')); } catch { /* first write */ }

          if (typeof got.name === 'string') {
            const name = got.name.trim().slice(0, 60);
            if (name) { cfg.name = name; audit('desk.renamed', { name }); }
          }
          if (Array.isArray(got.hidden)) {
            cfg.hidden = got.hidden.filter(s => typeof s === 'string').slice(0, 50);
            audit('cards.putaway', { cards: cfg.hidden });
          }
          /* Separate from `hidden` on purpose: "not right now" and "never again" are
             different wishes, and the tray only offers back the first kind. */
          if (Array.isArray(got.gone)) {
            const want = got.gone.filter(s => typeof s === 'string').slice(0, 50);
            audit('cards.forgotten', { cards: want });
            /* Deleted for real where possible; only what resists deletion stays listed,
               so the list is a record of failures rather than a growing pile. */
            cfg.gone = want.filter(id => !deleteCard(id));
          }
          writeFileSync(DCFG, JSON.stringify(cfg, null, 2) + '\n');
        } catch { /* a bad post is not worth a 500 */ }
        res.writeHead(204); res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    try { res.end(readFileSync(DCFG)); } catch { res.end('{"name":"your desk"}'); }
    return;
  }

  const ASSETS = { '/icon-claude.svg': 'image/svg+xml',
                   '/icon-john.svg':   'image/svg+xml',
                   '/desk-art.png':    'image/png' };
  if (Object.hasOwn(ASSETS, req.url)) {
    try {
      res.writeHead(200, { 'content-type': ASSETS[req.url], 'cache-control': 'no-store' });
      res.end(readFileSync(new URL('.' + req.url, import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
    return;
  }

  if (req.url === '/board') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    try { res.end(readFileSync(BOARD)); } catch { res.end('(nothing on the board)'); }
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // 'wasm-unsafe-eval' permits WebAssembly compilation and nothing else — notably NOT
    // eval() or new Function(). Graphviz, behind jssm's viz component, is wasm; without
    // this the module resolves, instantiation is refused, and the failure is silent.
    'content-security-policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      // 'self' joins font-src for KaTeX, whose fonts we serve from our own origin.
      "font-src 'self' https://fonts.gstatic.com; " +
      /* There was no `img-src`, so images fell back to `default-src 'self'` and a `data:` URI —
         which is not `'self'` — could not load. The `image` card documents `data:` as one of its
         two permitted sources and refuses everything else on the grounds that a remote image fails
         invisibly; without this line its own permitted source failed invisibly too. `data:` only:
         still no remote image, so the card's reasoning is unchanged and now also true. */
      "img-src 'self' data:; " +
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
      "connect-src 'self'",
  });
  const isDesk = req.url.startsWith('/desk');

  /* Assembled per request rather than stored: the deck on disk is the only truth, so a
     card that was deleted is simply not there to render. There is no hiding step, and so
     no window in which a dismissed card is briefly visible. */
  let page = isDesk ? assemble(readFileSync(DESK, 'utf8'), DECK)
                    : assemble(readFileSync(HTML, 'utf8'), MYDECK);

  /* The kit is inlined rather than linked. A `<script src>` would keep its contents out of
     the page digest, so editing the kit would change every card's behaviour without the
     open desks ever being told the code had moved — which is exactly the class of silent
     staleness the digest exists to prevent. */
  for (const [slot, file] of [['<!--KIT-CSS-->', 'kit.css'], ['<!--KIT-JS-->', 'kit.js']]) {
    if (!page.includes(slot)) continue;
    let body = '';
    try { body = readFileSync(new URL(`./cardkit/${file}`, import.meta.url), 'utf8'); }
    catch { body = `/* cardkit: ${file} is missing */`; }
    page = page.replace(slot, () => body);
  }

  /* An import map has to be inline and ahead of every module it governs, so it is
     substituted here rather than fetched. Graphviz is added to whatever the generator
     produced, since it is resolved by path rather than from node_modules. */
  if (page.includes('<!--IMPORTMAP-->')) {
    let imports = {};
    try { imports = JSON.parse(readFileSync(new URL('./importmap.json', import.meta.url), 'utf8')).imports; }
    catch { /* no generated map; graphviz alone still works */ }
    imports['@viz-js/viz'] = '/vendor/viz.js';
    page = page.replace('<!--IMPORTMAP-->',
      `<script type="importmap">${JSON.stringify({ imports }, null, 1)}</script>`);
  }

  res.end(stampCode(page));

});

/**
 * Announce this server so a second editor window can find it instead of colliding with it.
 *
 * One file per process, named by pid, rather than one shared list: two servers starting at
 * once would race a read-modify-write on a list and one of them would vanish from it. A
 * directory of small files has no such window, and a dead server's file is recognisable
 * because its pid no longer answers signal 0.
 *
 * @param port the port actually bound, which is not necessarily the one asked for
 *
 * @example
 * announce(7373);   // writes ~/.claude/desks/12345.json
 */
function announce(port) {
  try {
    mkdirSync(DESKS, { recursive: true });
    for (const name of readdirSync(DESKS)) {                 // sweep servers that have died
      const pid = Number(name.replace(/\.json$/, ''));
      if (!Number.isInteger(pid)) continue;
      try { process.kill(pid, 0); }                          // throws when the pid is gone
      catch { try { unlinkSync(join(DESKS, name)); } catch { /* someone else swept it */ } }
    }
    writeFileSync(join(DESKS, `${process.pid}.json`), JSON.stringify({
      pid: process.pid, port, url: `http://127.0.0.1:${port}/`,
      deck: DECK, started: new Date().toISOString(),
    }, null, 2) + '\n');
  } catch (e) {
    console.log('could not announce this desk:', String(e));  // never fatal: it is a hint
  }
}

const bye = () => { try { unlinkSync(join(DESKS, `${process.pid}.json`)); } catch { /* gone */ } };
process.on('exit', bye);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { bye(); process.exit(0); });

/* Ask for the usual port, take any port rather than dying for it.
 *
 * A second editor window running a second desk used to hit an unhandled EADDRINUSE, and
 * because the server is started detached the crash was invisible — the desk simply never
 * appeared. Falling back to an ephemeral port means the common single-window case keeps its
 * memorable URL and the second window still works; `announce` is how anyone finds it. */
server.on('error', err => {
  if (err.code !== 'EADDRINUSE') { console.error(err); process.exit(1); }
  console.log(`port ${PORT} is taken — another desk is already running there; taking any port`);
  server.listen(0, '127.0.0.1');
});
server.on('listening', () => {
  const port = server.address().port;
  announce(port);
  console.log(`panel: http://127.0.0.1:${port}/`);
});
server.listen(PORT, '127.0.0.1');
