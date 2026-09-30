#!/usr/bin/env node
/**
 * The desk server: a local panel that shows a standing surface and takes input back.
 *
 * Dependency-free on purpose — `node:http`, `node:sqlite`, `node:fs`, `node:path`,
 * `node:os` and nothing else — so it can be started, used, killed and forgotten without
 * installing anything or leaving anything behind. Every file it serves is re-read on the
 * request that needs it, so an edit lands on the next refresh with no restart.
 *
 * Two surfaces share the one process. `/desk` is assembled from a card deck (see
 * `deskcards.mjs`) against `desk-shell.html`; everything else is `panel.html`, a single
 * monolithic document that has not been converted to cards yet.
 *
 * The **mechanism** — this file, `deskcards.mjs`, the shell, the panel, the icons — lives
 * beside this script and is the same for every desk. A **desk** — its cards, its
 * configuration, its questions, its board, its vendored libraries — is one directory
 * somewhere else, named on the command line. Nothing in a desk directory is ever created
 * by this file except in response to a request that writes to it.
 *
 * @example
 *   // From anywhere, pointing at a desk directory:
 *   node src/scripts/desk/panel.mjs C:/Users/me/.desks/mine
 *   // panel: http://127.0.0.1:7373/   desk: C:\Users\me\.desks\mine
 *
 * @example
 *   // Or by environment, which is what a launcher usually wants:
 *   SELF_EXPRESSION_DESK=~/.desks/mine SELF_EXPRESSION_DESK_PORT=7400 node src/scripts/desk/panel.mjs
 *
 * @example
 *   // With the inbox listing a repo's open pull requests (or set "repo" in desk-config.json):
 *   SELF_EXPRESSION_DESK_REPO=StoneCypher/self-expression node src/scripts/desk/panel.mjs ~/.desks/mine
 *
 * @see deskcards.mjs — the card deck: what a card is and why it is a directory
 * @see deskinbox.mjs — the inbox: pull requests, intents, permalinks, questions
 * @see src/doc_md/desk.md — the conventions: dismissal tiers, inbox protocol, hot-swap
 */

import { createServer }  from 'node:http';
import { DatabaseSync }  from 'node:sqlite';
import { readFileSync, appendFileSync, writeFileSync, renameSync, watch }  from 'node:fs';
import { dirname, join, resolve }  from 'node:path';
import { fileURLToPath }  from 'node:url';
import { homedir }        from 'node:os';

import { assemble, removeCard }  from './deskcards.mjs';
import { requestAllowed }        from './deskguard.mjs';
import { applyInboxPost, applyPrIntent, auditRow, createPullRequestFeed, ghRunner,
         openExternally, parseInbox, readAudit }  from './deskinbox.mjs';

/** Where the mechanism lives: the shell, the panel, the icons. Shared by every desk. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where this desk lives: its cards and all of its state.
 *
 * Taken from the first argument, then `SELF_EXPRESSION_DESK`. A desk is deliberately not a
 * default location: two desks on one machine are normal, and a desk that guessed where it
 * lived would be a desk that could silently answer for the wrong one — started with no
 * argument and no environment variable in an unexpected directory, a guessed desk would
 * make that directory's `cards/` deletable by `desk-config`'s `gone` list. So there is no
 * guess: with neither given, the process prints how to fix that and exits rather than
 * picking somewhere.
 */
const deskArg = process.argv[2] ?? process.env.SELF_EXPRESSION_DESK;
if (!deskArg) {
  console.error('usage: node src/scripts/desk/panel.mjs <desk directory>');
  console.error('   or: SELF_EXPRESSION_DESK=<desk directory> node src/scripts/desk/panel.mjs');
  process.exit(1);
}
const DESK = resolve(deskArg);

/**
 * The port. Overridable because a second desk on the same machine needs a second port, and
 * because a test wants an OS-assigned ephemeral one.
 *
 * Read as a string first and only defaulted when unset: `Number(x) || 7373` would silently
 * turn a requested port `0` (Node's "pick any free port" convention, which is exactly what
 * a test needs) back into `7373`, since `0` is falsy.
 */
const PORT = (() => {
  const raw = process.env.SELF_EXPRESSION_DESK_PORT;
  return raw !== undefined && raw !== '' ? Number(raw) : 7373;
})();

/**
 * The affect log the panel charts, opened read-only.
 *
 * Read-only so concurrent sessions writing to it are never blocked, and so a panel left
 * running cannot damage the thing it exists to display.
 */
const DB = process.env.SELF_EXPRESSION_AFFECT_LOG
        ?? join(homedir(), '.claude', 'affect-log.sqlite3');

const SHELL  = join(HERE, 'desk-shell.html');    // structure only; cards fill it
const KIT    = join(HERE, 'cardkit');           // kit.js / kit.css, shared by every kit-built card
const HTML   = join(HERE, 'panel.html');         // the un-converted second surface
const DECK   = join(DESK, 'cards');
const BOARD  = join(DESK, 'board.md');
const DCFG   = join(DESK, 'desk-config.json');
const INBOX  = join(DESK, 'inbox.jsonl');
const QUES   = join(DESK, 'questions.json');
const GEOM   = join(DESK, 'geometry.json');
const IMAP   = join(DESK, 'importmap.json');
const VENDOR = join(DESK, 'vendor', 'node_modules');
const AUDIT  = join(DESK, 'audit.jsonl');

let received = 0;

/**
 * Bumped whenever anything the page is made of changes on disk, so open pages can renew
 * themselves. Debounced because Windows fires several events per save.
 */
let edition = 0;
let settle  = null;
const bump = () => {
  clearTimeout(settle);
  settle = setTimeout(() => { edition += 1; console.log('edition', edition); }, 120);
};

/**
 * Watch one path for changes, tolerating its absence.
 *
 * Everything here is optional to a desk — a desk with no cards, no import map and no
 * second surface is a legitimate desk — so a missing path is reported once and the server
 * carries on rather than refusing to start over a file nobody asked for.
 *
 * @param path      the file or directory to watch
 * @param recursive whether to watch a directory's whole subtree
 * @returns nothing; the watch is registered or the absence is logged
 *
 * @example
 * watchOrSay(DECK, true);    // 'not watching …\cards (nothing there yet)' when absent
 */
function watchOrSay(path, recursive = false) {
  try { watch(path, { recursive }, bump); }
  catch { console.log(`not watching ${path} (nothing there yet)`); }
}

watchOrSay(SHELL);
/* The kit is part of the page, and — because it is inlined rather than linked — editing it
   changes every card's behaviour, so open desks must renew. Watched by file, not by walking
   `cardkit/` recursively: a recursive watch on sixty type modules fires on every save under it. */
watchOrSay(join(KIT, 'kit.css'));
watchOrSay(join(KIT, 'kit.js'));
watchOrSay(HTML);
/* The deck is part of the page, so a card appearing, changing or being deleted is a change
   to the desk exactly as an edit to the shell is. */
watchOrSay(DECK, true);
/* The map is injected into the page, so regenerating it changes the page. */
watchOrSay(IMAP);

/**
 * The affect log's connection, or `null` when there is no log to open.
 *
 * A desk is useful without one — the cards, the inbox and the ask box need no database —
 * so an absent or unreadable log costs the history charts and nothing else. Failing to
 * start would make one desk's data a requirement of the mechanism.
 */
const db = openLog();

/**
 * Open the affect log read-only, or report why not.
 *
 * @returns the open database, or `null` when it cannot be opened
 *
 * @example
 * openLog();     // null, and 'no affect log at …' on the console, on a fresh machine
 */
function openLog() {
  try { return new DatabaseSync(DB, { readOnly: true }); }
  catch (e) { console.log(`no affect log at ${DB} (${e.message}); history is empty`); return null; }
}

const recentQ = db?.prepare(`
  select id, ts_local, tz, project, session, position, delta, uncertain,
         face, context, text, need, turn, cctype
    from signatures
   order by id desc
   limit 60
`);

const todayQ = db?.prepare(`
  select ts_local, text from signatures
   where date(ts_utc) = date('now')
   order by id asc
`);

/** Hue per word stem, so a run of one mood reads as a band of one colour. */
const STEM_HUE = { flow: 235, spark: 75, drag: 35, fog: 290, strain: 20, still: 165 };

/**
 * Pull the stem word off the front of a signature's text, if it has one.
 *
 * The convention is `stem; the rest of it`, so the stem is the first word before the first
 * semicolon. Anything that is not a known stem reads as no stem rather than as a new one:
 * the palette is fixed, and inventing a hue for a typo would make the chart lie.
 *
 * @param text one signature's text
 * @returns the stem, or `null` when the text does not open with one
 *
 * @example
 * stemOf('flow; clear plan, enjoying this');   // 'flow'
 * stemOf('finally got it working');            // null
 */
function stemOf(text) {
  const word = String(text ?? '').split(';')[0].trim().toLowerCase().split(/\s+/)[0];
  return Object.hasOwn(STEM_HUE, word) ? word : null;
}

/**
 * The current state of the log, as the stream sends it.
 *
 * `maxId` is the change detector: the stream compares it rather than the whole payload, so
 * an unchanged log costs one integer comparison per tick instead of a re-serialisation.
 *
 * @returns `{ rows, today, maxId }`; all empty when there is no log
 *
 * @example
 * snapshot().maxId;    // 4127, the newest signature's id
 */
function snapshot() {
  if (!recentQ || !todayQ) return { rows: [], today: [], maxId: 0 };
  const rows  = recentQ.all().map(r => ({ ...r, stem: stemOf(r.text) })),
        today = todayQ.all().map(r => ({ hour: Number(String(r.ts_local).split(':')[0]) || 0,
                                         stem: stemOf(r.text) }));
  return { rows, today, maxId: rows.length ? rows[0].id : 0 };
}

/**
 * Remove a card for good: one directory, gone.
 *
 * This replaces an index-scanning cut through the desk's HTML that had to find the section,
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
  console.log(gone ? `removed card: ${id}` : `no such removable card: ${id}`);
  return gone;
}

/** The last `questions.json` that parsed, served while a rewrite is half-way through. */
let lastGoodInbox = null;

/**
 * The inbox: every question the assistant has put to the desk's owner, with the answer
 * once one is given.
 *
 * Kept on disk rather than in memory for two reasons — a restarted server must not lose
 * what is outstanding, and a session can post a new question simply by writing the file,
 * with no endpoint and no running handle required.
 *
 * A read that lands mid-rewrite fails to parse, and answering `[]` for that is a lie the page
 * cannot detect: "empty" and "unreadable" render identically, so the inbox would blink empty
 * whenever anyone edited the file. The last good copy is served instead — stale by at most
 * one poll. An absent file is different: it really is empty, and answers so.
 *
 * @returns `{ questions, reserve }` — the rows in the order they were asked, and the bench of
 *          ticket suggestions; both `[]` when the file is absent
 *
 * @example
 * inboxDoc().questions.filter(q => !q.answer);   // the ones still waiting on the owner
 */
function inboxDoc() {
  let text;
  try { text = readFileSync(QUES, 'utf8'); }
  catch { lastGoodInbox = null; return { questions: [], reserve: [] }; }
  try { lastGoodInbox = parseInbox(text); }
  catch { /* mid-write: fall through to the last good copy */ }
  return lastGoodInbox ?? { questions: [], reserve: [] };
}

/**
 * Write JSON where a concurrent reader can never see a half-written file.
 *
 * `writeFileSync` truncates and then fills, so a reader polling every few seconds eventually
 * catches the empty middle. Writing beside the target and renaming is atomic within a volume:
 * readers see the whole old file or the whole new one.
 *
 * @param path the destination file
 * @param data the value to serialise
 * @returns nothing
 *
 * @example
 * writeJson(QUES, { questions: [], reserve: [] });   // no reader ever observes a partial write
 */
function writeJson(path, data) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

/**
 * The desk's configuration, or `{}` when there is none or it cannot be read.
 *
 * @returns the parsed `desk-config.json`
 *
 * @example
 * readConfig().repo;   // 'StoneCypher/self-expression', when the desk names one
 */
function readConfig() {
  try {
    const cfg = JSON.parse(readFileSync(DCFG, 'utf8'));
    return cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch { return {}; }
}

/**
 * Record one state-changing action in the desk's `audit.jsonl`, append-only.
 *
 * The desk is reachable over loopback HTTP and never passes through the permission prompts or
 * hooks that gate a session, which is most of why it feels quick. It also means its side
 * effects — launching a browser, recording that a PR should land — happen with nothing
 * watching. The log gates nothing; it makes what happened reviewable afterwards by someone
 * who was not there. Refusals are logged too, and they are the more informative half.
 *
 * @param action dotted verb, e.g. `pr.intent`, `open.refused`
 * @param detail whatever identifies the target; small and non-secret
 * @returns nothing; a failed write is reported on the console and never fails the request
 *
 * @example
 * audit('pr.intent', { number: 135, intent: 'land', note: 'recorded only; no GitHub write' });
 */
function audit(action, detail) {
  const row = auditRow(action, detail, new Date().toISOString());
  try { appendFileSync(AUDIT, JSON.stringify(row) + '\n'); }
  catch (e) { console.log('AUDIT WRITE FAILED', action, e.message); }
  console.log('audit:', action, JSON.stringify(detail));
}

/**
 * The repo's open pull requests, as the inbox lists them.
 *
 * Which repo is `SELF_EXPRESSION_DESK_REPO`, else `desk-config.json`'s `repo`, else none — in
 * which case the inbox says so rather than guessing. `SELF_EXPRESSION_DESK_GH` names the `gh`
 * binary when it is not on the path. See `createPullRequestFeed` for the caching.
 */
const prFeed = createPullRequestFeed({
  run:        ghRunner(process.env.SELF_EXPRESSION_DESK_GH || 'gh'),
  readConfig,
  env:        process.env.SELF_EXPRESSION_DESK_REPO,
});

/**
 * Collect a request body and hand it over parsed, or `undefined` when it is not JSON.
 *
 * @param req  the incoming request
 * @param then called once with the parsed body
 * @returns nothing
 *
 * @example
 * readJson(req, got => { … });
 */
function readJson(req, then) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let got;
    try { got = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { got = undefined; }
    then(got);
  });
}

/**
 * The port the server is actually bound to.
 *
 * Equal to `PORT` unless `PORT` is `0`, in which case the OS picked one and this is
 * updated from `server.address()` once `listen` reports it. The request guard checks
 * against this, not `PORT`, since a `Host`/`Origin` check against a nominal `0` would
 * refuse every request.
 */
let boundPort = PORT;

const server = createServer((req, res) => {

  const allowed = requestAllowed(req, boundPort);
  if (!allowed.ok) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`forbidden: ${allowed.reason}\n`);
    return;
  }

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
      /* One way, and to the log: the assistant reads its own console, and a channel that
         wrote back into the page would need a delivery guarantee nothing here can make. */
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
      if (edition !== seenEdition) {            // the page itself changed; tell it to renew
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
    try { res.end(readFileSync(IMAP)); }
    catch { res.end('{"imports":{}}'); }
    return;
  }

  /* The desk's vendored packages, served from our own origin so `script-src 'self'` can
     stay as it is. A desk that needs a library puts it under `vendor/node_modules/` and
     names it in `importmap.json`; the mechanism knows no package by name. */
  if (req.url.startsWith('/nm/')) {
    const rel = decodeURIComponent(req.url.slice('/nm/'.length).replace(/[?#].*$/, ''));
    if (rel.includes('..')) { res.writeHead(400); return res.end(); }
    /* Read before writing the status line. A desk with no vendor tree is the normal case,
       and heading a response 200 before finding out would make the miss unreportable. */
    let body;
    try { body = readFileSync(join(VENDOR, rel)); }
    catch { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8',
                         'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  if (req.url === '/questions') {
    if (req.method === 'POST') {              // the owner answers; the answer is for the assistant
      readJson(req, got => {
        /* The rules — one-way answers, drops that delete, tickets refilled from the bench —
           live in `applyInboxPost`. Written back whole, `reserve` included, so answering a
           question can never erase the bench, and atomically, so the page never reads a
           half-written file. */
        try {
          const { doc, event } = applyInboxPost(inboxDoc(), got, new Date().toISOString());
          if (event) {
            writeJson(QUES, doc);
            lastGoodInbox = doc;
            console.log('inbox:', JSON.stringify(event));
          }
        } catch (e) { console.log('inbox: could not write', e.message); }
        res.writeHead(204); res.end();
      });
      return;
    }
    const body = JSON.stringify({ questions: inboxDoc().questions });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  /* The repo's open pull requests, split by whose account opened them. Never a blank: with
     no repo, no `gh`, or `gh` failing, the answer carries an `error` the inbox shows. */
  if (req.url === '/prs') {
    prFeed.get().then(
      data => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify(data)); },
      e    => { res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ repo: null, viewer: null, mine: [], theirs: [], warning: null,
                                         fetchedAt: null, error: `could not list pull requests: ${e.message}` })); });
    return;
  }

  /* Records what the owner wants done with a PR, and deliberately does NOT do it: `land`
     means merging into a protected branch, which is a thing to be asked about every time
     rather than a side effect of a click. `drop` only hides the row on this desk. */
  if (req.method === 'POST' && req.url === '/pr') {
    readJson(req, got => {
      const next = got && typeof got === 'object' ? applyPrIntent(readConfig(), got.number, got.action) : null;
      if (next === null) {
        audit('pr.intent.refused', { body: JSON.stringify(got ?? null).slice(0, 200) });
        res.writeHead(400); res.end();
        return;
      }
      try { writeJson(DCFG, next); }
      catch (e) { res.writeHead(500); res.end(); console.log('pr: could not write', e.message); return; }
      audit('pr.intent', { number: Number(got.number), intent: got.action, note: 'recorded only; no GitHub write' });
      res.writeHead(204); res.end();
    });
    return;
  }

  /* The owner clicked a permalink. Only exact issue/PR permalinks are opened; see
     `openExternally` for why this is narrow and why it is not a plain link. */
  if (req.method === 'POST' && req.url === '/open') {
    readJson(req, got => {
      const ok = openExternally(got && typeof got === 'object' ? got.url : undefined, { audit });
      res.writeHead(ok ? 204 : 400); res.end();
    });
    return;
  }

  /* The audit log is readable over the same wire that writes it — a record only its author
     can inspect is not much of a record. Read-only: no route edits or truncates it. */
  if (req.url === '/audit' || req.url.startsWith('/audit?')) {
    const want = Number(new URL(req.url, 'http://x').searchParams.get('n'));
    let text = '';
    try { text = readFileSync(AUDIT, 'utf8'); } catch { /* nothing has happened yet */ }
    const body = JSON.stringify(readAudit(text, want));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
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
            if (name) { cfg.name = name; console.log('desk renamed:', name); }
          }
          if (Array.isArray(got.hidden)) {
            cfg.hidden = got.hidden.filter(s => typeof s === 'string').slice(0, 50);
            console.log('put away:', cfg.hidden.join(', ') || '(nothing)');
          }
          /* Separate from `hidden` on purpose: "not right now" and "never again" are
             different wishes, and the tray only offers back the first kind. */
          if (Array.isArray(got.gone)) {
            const want = got.gone.filter(s => typeof s === 'string').slice(0, 50);
            console.log('dismissed for good:', want.join(', ') || '(nothing)');
            /* Deleted for real where possible; only what resists deletion stays listed,
               so the list is a record of failures rather than a growing pile. */
            cfg.gone = want.filter(id => !deleteCard(id));
          }
          writeJson(DCFG, cfg);
        } catch { /* a bad post is not worth a 500 */ }
        res.writeHead(204); res.end();
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    try { res.end(readFileSync(DCFG)); } catch { res.end('{"name":"your desk"}'); }
    return;
  }

  /* Two icons ship with the mechanism because the shell and the panel each reference one
     as their favicon; anything else pictorial belongs to a desk. */
  const SHIPPED = { '/icon-claude.svg': 'image/svg+xml',
                    '/icon-john.svg':   'image/svg+xml' };
  const OWNED   = { '/desk-art.png':    'image/png' };
  if (Object.hasOwn(SHIPPED, req.url) || Object.hasOwn(OWNED, req.url)) {
    const shipped = Object.hasOwn(SHIPPED, req.url);
    let body;                                   // read first; see the /nm/ route above
    try { body = readFileSync(join(shipped ? HERE : DESK, req.url.slice(1))); }
    catch { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': shipped ? SHIPPED[req.url] : OWNED[req.url],
                         'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  if (req.url === '/board') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    try { res.end(readFileSync(BOARD)); } catch { res.end('(nothing on the board)'); }
    return;
  }

  const isDesk = req.url.startsWith('/desk');

  /* Assembled per request rather than stored: the deck on disk is the only truth, so a
     card that was deleted is simply not there to render. There is no hiding step, and so
     no window in which a dismissed card is briefly visible.

     Read before the status line is written, like every other route: a shell that is
     missing or mid-save must be reportable as a failure, not thrown after a 200 is out. */
  let page;
  try {
    page = isDesk ? assemble(readFileSync(SHELL, 'utf8'), DECK)
                  : readFileSync(HTML, 'utf8');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`could not assemble the page: ${e.message}\n`);
    return;
  }

  /* The kit is inlined rather than linked. A `<script src>` would keep its contents out of
     the page, so editing the kit would change every card's behaviour without the open desks
     being told the code had moved. Replacements are functions so `$&` in the kit stays text. */
  for (const [slot, file] of [['<!--KIT-CSS-->', 'kit.css'], ['<!--KIT-JS-->', 'kit.js']]) {
    if (!page.includes(slot)) continue;
    let body = '';
    try { body = readFileSync(join(KIT, file), 'utf8'); }
    catch { body = `/* cardkit: ${file} is missing */`; }
    page = page.replace(slot, () => body);
  }

  /* An import map has to be inline and ahead of every module it governs, so it is
     substituted here rather than fetched. */
  if (page.includes('<!--IMPORTMAP-->')) {
    let imports = {};
    try { imports = JSON.parse(readFileSync(IMAP, 'utf8')).imports ?? {}; }
    catch { /* no map; a desk that vendors nothing needs none */ }
    page = page.replace('<!--IMPORTMAP-->',
      `<script type="importmap">${JSON.stringify({ imports }, null, 1)}</script>`);
  }

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // 'wasm-unsafe-eval' permits WebAssembly compilation and nothing else — notably NOT
    // eval() or new Function(). A vendored library compiled to wasm needs it; without
    // this the module resolves, instantiation is refused, and the failure is silent.
    'content-security-policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
      "connect-src 'self'",
  });
  res.end(page);

});

/**
 * Two desks on one machine are normal (see the file docstring), so the second one to start
 * on a given port must say so and exit rather than crash: `listen` emits `'error'` rather
 * than throwing, and an `EventEmitter` with no `'error'` listener turns an unhandled one
 * into an uncaught exception — that is the failure this replaces.
 */
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`panel: port ${PORT} is already in use — is another desk already running there?`);
  } else {
    console.error(`panel: failed to start (${err.message})`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  boundPort = server.address().port;
  console.log(`panel: http://127.0.0.1:${boundPort}/`);
  console.log(`desk:  ${DESK}`);
});
