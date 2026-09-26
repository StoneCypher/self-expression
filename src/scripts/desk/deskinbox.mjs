/**
 * The desk inbox's logic: the repo's open pull requests, the tracker issues that fill the
 * ticket rail, the owner's intents for both, issue permalinks, and the hand-written
 * `questions.json` rows — everything the inbox decides, kept apart from the HTTP server that
 * serves it.
 *
 * Split out of `panel.mjs` for the same reason `deskguard.mjs` is: every decision here is a
 * function of its inputs, so it can be tested without a socket, and the one thing that
 * reaches the outside world — running `gh` — is passed in rather than imported, so no test
 * ever talks to the real GitHub. `panel.mjs` supplies {@link ghRunner}; a test supplies a
 * stub that returns canned output or fails on purpose.
 *
 * Dependency-free like the rest of the desk: `node:child_process` and nothing else.
 *
 * @see ./panel.mjs — the routes that serve these (`/prs`, `/pr`, `/tickets`, `/ticket`, `/open`,
 *      `/audit`, `/questions`)
 * @see ../../doc_md/desk.md — the inbox protocol, including pull requests and tickets
 */

import { execFile, spawn } from 'node:child_process';

/**
 * Exactly a GitHub issue or pull-request permalink, and nothing else.
 *
 * Deliberately anchored at both ends and deliberately narrow: `/open` hands whatever passes
 * this to the operating system's URL opener, so anything looser would turn a loopback
 * endpoint into a general "launch any URI" primitive.
 *
 * @example
 * ISSUE_URL.test('https://github.com/StoneCypher/self-expression/issues/134');  // true
 * ISSUE_URL.test('file:///C:/Windows/System32');                                // false
 */
export const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]{1,39}\/[\w.-]{1,100}\/(issues|pull)\/\d{1,7}$/;

/**
 * A GitHub `owner/name` pair, and nothing that could be read as anything else.
 *
 * The owner half follows GitHub's 39-character login limit and the name half its 100-character
 * repository limit. No character outside `[A-Za-z0-9_.-]` is admitted, so a configured repo can
 * never smuggle an option (`--foo`) or a path into the `gh` argument list.
 *
 * @example
 * REPO_NAME.test('StoneCypher/self-expression');   // true
 * REPO_NAME.test('--repo=evil/x');                 // false
 */
export const REPO_NAME = /^(?!-)[\w.-]{1,39}\/(?!-)[\w.-]{1,100}$/;

/** What the owner can ask for a pull request. `land` and `agent` are recorded; `drop` hides it. */
export const PR_ACTIONS = Object.freeze(['land', 'agent', 'drop']);

/** How long one `gh pr list` answer is reused, in milliseconds. Open PRs do not move by the second. */
export const PR_TTL_MS = 60_000;

/** The label GitHub's own agent tooling puts on a pull request it opened. */
export const AI_LABEL = 'Created by AI';

/** The fields `gh pr list` is asked for — every one the inbox reads, and no others. */
const PR_FIELDS = 'number,title,author,isDraft,reviewDecision,labels';

/**
 * Whether a string is a GitHub issue or pull-request permalink.
 *
 * @param url anything; non-strings are simply not permalinks
 * @returns true only for an exact issue or PR permalink
 *
 * @example
 * isIssueUrl('https://github.com/StoneCypher/self-expression/pull/135');  // true
 * isIssueUrl('https://github.com/StoneCypher/self-expression/pull/135#x'); // false
 * @see ISSUE_URL
 */
export function isIssueUrl(url) {
  return typeof url === 'string' && ISSUE_URL.test(url);
}

/**
 * Decide which repo the inbox is about, from the environment and then the desk's config.
 *
 * The environment wins because it is what a launcher sets for one run; the config is the
 * desk's standing choice. There is deliberately no third fallback — not the working
 * directory's git remote, not this plugin's own repo. A desk that guessed its repo would list
 * someone else's pull requests and link every ticket number to the wrong tracker, and nothing
 * on the page would say so. With neither set, the inbox says it has no repo instead.
 *
 * @param envValue the `SELF_EXPRESSION_DESK_REPO` value, or undefined
 * @param cfg      the parsed `desk-config.json`, whose `repo` field is consulted
 * @returns `{ repo, problem }`: the repo when one is set and well formed, otherwise `null`
 *          and a sentence the inbox can show the owner
 *
 * @example
 * resolveRepo(undefined, { repo: 'StoneCypher/self-expression' });
 * // { repo: 'StoneCypher/self-expression', problem: null }
 * resolveRepo('bad repo', {});
 * // { repo: null, problem: 'SELF_EXPRESSION_DESK_REPO is not an owner/name pair: "bad repo"' }
 */
export function resolveRepo(envValue, cfg) {
  const fromEnv = typeof envValue === 'string' && envValue.trim() !== '';
  const raw     = fromEnv ? envValue.trim() : cfg?.repo;
  const where   = fromEnv ? 'SELF_EXPRESSION_DESK_REPO' : 'desk-config.json\'s "repo"';

  if (raw === undefined || raw === null || raw === '') {
    return { repo: null, problem: 'no repo configured — set "repo" in desk-config.json, or SELF_EXPRESSION_DESK_REPO' };
  }
  if (typeof raw !== 'string' || !REPO_NAME.test(raw)) {
    return { repo: null, problem: `${where} is not an owner/name pair: ${JSON.stringify(String(raw)).slice(0, 120)}` };
  }
  return { repo: raw, problem: null };
}

/**
 * The PR numbers hidden on this desk, as a set of integers.
 *
 * Tolerant of hand edits: a number written as a string still hides its PR, and anything that
 * is not an integer is ignored rather than failing the whole list.
 *
 * @param cfg the parsed `desk-config.json`
 * @returns the hidden PR numbers
 *
 * @example
 * hiddenPrs({ prHidden: [12, '14', 'x'] });   // Set { 12, 14 }
 */
export function hiddenPrs(cfg) {
  const list = Array.isArray(cfg?.prHidden) ? cfg.prHidden : [];
  /* `Number(null)` and `Number('')` are 0, which is no PR's number, so only positives count. */
  return new Set(list.map(Number).filter(n => Number.isInteger(n) && n > 0));
}

/**
 * Split open pull requests into the owner's and everyone else's, dropping hidden ones.
 *
 * Two independent facts, deliberately not conflated. The **group** is ownership: whose
 * GitHub account opened it, and therefore who answers for it. An agent pushing under the
 * owner's token is the owner as far as GitHub is concerned, and that is the intent —
 * authorship is the account, not the hands. The `ai` flag is the other fact, whose hands
 * wrote it, and it only tints the row; it never moves it between groups.
 *
 * With no `viewer` (GitHub could not say who the owner is), every PR lands in `theirs`: an
 * unknown owner owns nothing, which is the direction that cannot claim someone else's work.
 *
 * @param rows   the parsed `gh pr list --json …` array; malformed entries are skipped
 * @param opts   `viewer` (the owner's login, or null), `cfg` (the parsed desk config, for
 *               `prHidden` and `prIntent`)
 * @returns `{ mine, theirs }`, each a list of `{ number, title, draft, review, ai, intent }`
 *          in the order `gh` returned them
 *
 * @example
 * splitPullRequests([{ number: 7, title: 'x', author: { login: 'me' } }],
 *                   { viewer: 'me', cfg: { prIntent: { 7: 'land' } } });
 * // { mine: [{ number: 7, title: 'x', draft: false, review: null, ai: false, intent: 'land' }],
 * //   theirs: [] }
 */
export function splitPullRequests(rows, { viewer, cfg }) {
  const hidden = hiddenPrs(cfg);
  const intent = cfg?.prIntent && typeof cfg.prIntent === 'object' ? cfg.prIntent : {};
  const mine = [], theirs = [];

  for (const pr of Array.isArray(rows) ? rows : []) {
    if (!pr || !Number.isInteger(pr.number) || hidden.has(pr.number)) continue;
    const labels = Array.isArray(pr.labels) ? pr.labels : [];
    const row = {
      number: pr.number,
      title:  typeof pr.title === 'string' ? pr.title : '',
      draft:  pr.isDraft === true,
      review: typeof pr.reviewDecision === 'string' && pr.reviewDecision ? pr.reviewDecision : null,
      ai:     labels.some(l => l?.name === AI_LABEL),
      intent: Object.hasOwn(intent, pr.number) && PR_ACTIONS.includes(intent[pr.number])
                ? intent[pr.number] : null,
    };
    (viewer && pr.author?.login === viewer ? mine : theirs).push(row);
  }
  return { mine, theirs };
}

/**
 * Record what the owner wants done with one pull request, as a new desk config.
 *
 * Records only. `land` means "merge this", and merging into a protected branch is a thing to
 * be asked about every time, never the side effect of a click — so the desk writes the wish
 * down and a person still authorises the merge out loud. `agent` likewise only records. `drop`
 * removes the PR from this desk (it stays open on GitHub) and forgets any intent it carried.
 *
 * Pure: the input is not modified.
 *
 * @param cfg    the parsed desk config
 * @param number the PR number
 * @param action one of {@link PR_ACTIONS}
 * @returns the updated config, or `null` when the number or the action is not acceptable
 *
 * @example
 * applyPrIntent({ name: 'd' }, 12, 'land');
 * // { name: 'd', prIntent: { 12: 'land' } }
 * applyPrIntent({ prIntent: { 12: 'land' } }, 12, 'drop');
 * // { prIntent: {}, prHidden: [12] }
 * applyPrIntent({}, 12, 'merge');   // null
 */
export function applyPrIntent(cfg, number, action) {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0 || !PR_ACTIONS.includes(action)) return null;

  const next     = { ...cfg };
  const prIntent = { ...(cfg?.prIntent && typeof cfg.prIntent === 'object' ? cfg.prIntent : {}) };

  if (action === 'drop') {
    delete prIntent[n];
    next.prHidden = [...hiddenPrs(cfg).add(n)];
  } else {
    prIntent[n] = action;
  }
  next.prIntent = prIntent;
  return next;
}

/**
 * One audit-log row: the detail, stamped with the time and the action name.
 *
 * The detail is spread **first** and the stamp after it, so a detail that happens to carry a
 * key named `action` or `at` cannot relabel its own row. A log whose payload can rewrite its
 * label fails silently and reads as correct, which is worse than no log.
 *
 * @param action dotted verb, e.g. `pr.intent`, `open.refused`
 * @param detail whatever identifies the target; keep it small and non-secret
 * @param at     the ISO timestamp to stamp
 * @returns the row to append
 *
 * @example
 * auditRow('pr.intent', { number: 12, action: 'spoof' }, '2026-09-26T10:00:00.000Z');
 * // { number: 12, action: 'pr.intent', at: '2026-09-26T10:00:00.000Z' }
 */
export function auditRow(action, detail, at) {
  return { ...detail, at, action };
}

/**
 * Read the newest audit rows out of the log's text.
 *
 * A line that is not JSON is reported as such rather than dropped, so a damaged log still
 * shows that something was there.
 *
 * @param text the whole `audit.jsonl`, or '' when there is none
 * @param want how many rows, clamped to 1..500 (default 100)
 * @returns `{ rows, showing }`, oldest first
 *
 * @example
 * readAudit('{"action":"a"}\n{"action":"b"}\n', 1);   // { rows: [{ action: 'b' }], showing: 1 }
 */
export function readAudit(text, want) {
  const n    = Math.min(500, Math.max(1, Number.isFinite(want) && want > 0 ? Math.floor(want) : 100));
  const rows = String(text ?? '').split('\n').filter(Boolean).slice(-n).map(line => {
    try { return JSON.parse(line); }
    catch { return { at: null, action: 'unparseable', raw: line.slice(0, 200) }; }
  });
  return { rows, showing: rows.length };
}

/**
 * The command a platform uses to open a URL in the user's own browser.
 *
 * @param platform a `process.platform` value
 * @param url      the URL to hand over (already validated by the caller)
 * @returns `[command, args]`
 *
 * @example
 * openerFor('win32', 'https://github.com/a/b/issues/1');   // ['explorer.exe', ['https://…']]
 */
export function openerFor(platform, url) {
  if (platform === 'win32')  return ['explorer.exe', [url]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}

/**
 * Start a program detached, without waiting on it or keeping the server alive for it.
 *
 * The default launcher for {@link openExternally}; tests pass their own so no browser ever
 * opens from a test run.
 *
 * @param cmd  the program
 * @param args its arguments
 * @returns nothing
 */
export function launchDetached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => { /* no opener on this machine; the audit row already says we tried */ });
  child.unref();
}

/**
 * Open a GitHub issue or pull request in the machine's real default browser.
 *
 * A plain `<a href>` is the wrong tool when the desk is viewed inside an embedded browser —
 * an editor tab, a preview pane — because following it navigates the desk itself away. Handing
 * the URL to the operating system opens the browser the owner actually uses.
 *
 * Refuses everything that is not an exact permalink ({@link ISSUE_URL}): this runs a program
 * with a URL on behalf of anything that can reach the loopback port, and must not become a
 * general "open any URI" primitive. Both outcomes are audited — a record of only the
 * successes cannot tell a guarded endpoint from an untested one.
 *
 * @param url    what the page asked to open
 * @param deps   `launch` (default {@link launchDetached}), `audit` (records the outcome),
 *               `platform` (default `process.platform`)
 * @returns whether the URL was accepted and handed to the opener
 *
 * @example
 * openExternally('https://github.com/StoneCypher/fsl/issues/712', { audit });   // true
 * openExternally('file:///C:/Windows/System32', { audit });                     // false; nothing runs
 */
export function openExternally(url, { launch = launchDetached, audit = () => {}, platform = process.platform } = {}) {
  if (!isIssueUrl(url)) {
    audit('open.refused', { url: String(url).slice(0, 200) });
    return false;
  }
  const [cmd, args] = openerFor(platform, url);
  launch(cmd, args);
  audit('open.allowed', { url, via: cmd });
  return true;
}

/**
 * Explain a failed `gh` run in one line the owner can act on.
 *
 * @param err    the error `execFile` reported
 * @param stderr whatever the program wrote to stderr
 * @param bin    the program that was run
 * @returns one sentence
 *
 * @example
 * ghFailure({ code: 'ENOENT' }, '', 'gh');   // 'gh is not installed or not on PATH (gh)'
 */
export function ghFailure(err, stderr, bin) {
  if (err?.code === 'ENOENT') return `gh is not installed or not on PATH (${bin})`;
  const said = String(stderr ?? '').trim().split('\n')[0] || String(err?.message ?? err).split('\n')[0];
  return `gh failed: ${said}`.slice(0, 300);
}

/**
 * The real command runner: runs `gh` with fixed arguments and reports what it said.
 *
 * No shell. Every argument is either a constant or a repo name that already passed
 * {@link REPO_NAME}, and `execFile` without a shell passes them as argv, so nothing a desk
 * config holds can become a command. `gh` is `gh.exe` on Windows, which `execFile` launches
 * directly; a `.cmd` shim would need `SELF_EXPRESSION_DESK_GH` pointed at the real binary.
 *
 * @param bin the program to run (default `gh`)
 * @returns `run(args)`, resolving to `{ ok: true, stdout }` or `{ ok: false, error }` — never
 *          rejecting, so a missing `gh` is an answer rather than a crash
 *
 * @example
 * await ghRunner()(['api', 'user', '--jq', '.login']);   // { ok: true, stdout: 'StoneCypher\n' }
 * await ghRunner('no-such-gh')(['--version']);
 * // { ok: false, error: 'gh is not installed or not on PATH (no-such-gh)' }
 */
export function ghRunner(bin = 'gh') {
  return args => new Promise(settle => {
    execFile(bin, args, { maxBuffer: 8 << 20, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) settle({ ok: false, error: ghFailure(err, stderr, bin) });
        else     settle({ ok: true, stdout: String(stdout) });
      });
  });
}

/**
 * Ask GitHub who the desk's owner is, once, and remember the answer.
 *
 * Both the pull-request feed and the issue feed need the owner's login — one to split PRs by
 * authorship, the other to find issues assigned to the owner — and it does not change while
 * the server runs, so one lookup serves both. Only a success is remembered: a lookup that
 * failed (not signed in, offline) is tried again on the next refresh rather than leaving the
 * desk anonymous for the rest of its life. Concurrent callers share one `gh api user` run.
 *
 * @param run a command runner, see {@link ghRunner}
 * @returns `whoami()`, resolving to the owner's login, or `null` when GitHub could not say
 *
 * @example
 * const whoami = createViewerLookup(ghRunner());
 * await whoami();   // 'StoneCypher'
 * await whoami();   // 'StoneCypher', with no second gh run
 * @see createPullRequestFeed
 * @see createIssueFeed
 */
export function createViewerLookup(run) {
  let viewer   = null;
  let inflight = null;

  async function ask() {
    const got = await run(['api', 'user', '--jq', '.login']);
    const who = got.ok ? got.stdout.trim() : '';
    if (who) viewer = who;
    return who || null;
  }

  return () => {
    if (viewer !== null) return Promise.resolve(viewer);
    if (inflight === null) {
      inflight = ask().catch(() => null).finally(() => { inflight = null; });
    }
    return inflight;
  };
}

/**
 * A per-repo cache of one `gh` answer, with concurrent refreshes coalesced into one run.
 *
 * The caching both inbox feeds share, kept in one place so the two cannot drift apart. The
 * entry is refreshed when there is none, when the repo changed, or when it is `ttlMs` old or
 * older. Callers that arrive while a refresh for the same repo is running wait on that
 * refresh rather than starting their own. A refresh that rejects — a runner that broke its
 * contract — is turned into an entry carrying an `error` sentence, so a caller always gets an
 * entry and never a rejection.
 *
 * @param opts `now` (milliseconds clock), `ttlMs` (how long an entry is reused),
 *             `refresh(repo)` (resolves to the entry's fields; `repo` and `at` are stamped here)
 * @returns `{ get(repo), invalidate() }`; `get` resolves to `{ repo, at, …fields }`
 *
 * @example
 * const cache = createRepoCache({ now: Date.now, ttlMs: 60_000,
 *                                 refresh: async repo => ({ rows: [], error: null, warning: null }) });
 * await cache.get('o/r');   // { rows: [], error: null, warning: null, repo: 'o/r', at: 1727… }
 */
function createRepoCache({ now, ttlMs, refresh }) {
  let cache    = null;          // { repo, at, … }
  let inflight = null;          // { repo, promise } while a refresh is running

  async function get(repo) {
    if (cache !== null && cache.repo === repo && now() - cache.at < ttlMs) return cache;
    if (inflight === null || inflight.repo !== repo) {
      /* A runner that rejects instead of answering broke its contract, but the inbox still
         owes the owner a sentence rather than a 500, so the rejection becomes an error row. */
      const promise = refresh(repo)
        .catch(e => ({ rows: [], viewer: null, warning: null,
                       error: `gh failed: ${String(e?.message ?? e).split('\n')[0]}` }))
        .then(fields => ({ ...fields, repo, at: now() }))
        .finally(() => { if (inflight?.promise === promise) inflight = null; });
      inflight = { repo, promise };
    }
    cache = await inflight.promise;
    return cache;
  }

  return { get, invalidate: () => { cache = null; } };
}

/**
 * Run one `gh … list --json` and read its answer as a list of rows.
 *
 * @param run  a command runner
 * @param args the full argv
 * @param what the command's name, for the error sentence (`gh pr list`)
 * @returns `{ rows, error }` — the parsed rows and `null`, or `[]` and a sentence
 *
 * @example
 * await listRows(run, ['pr', 'list', …], 'gh pr list');   // { rows: [{ number: 135, … }], error: null }
 */
async function listRows(run, args, what) {
  const list = await run(args);
  if (!list.ok) return { rows: [], error: list.error };
  let rows;
  try { rows = JSON.parse(list.stdout); } catch { rows = null; }
  return Array.isArray(rows) ? { rows, error: null }
                             : { rows: [], error: `${what} returned something that is not a list` };
}

/**
 * The inbox's pull-request feed: `gh pr list`, cached, split by authorship, hidden PRs removed.
 *
 * Cached because the page asks every minute from every open tab, and `gh pr list` is a
 * network round trip. What is cached is GitHub's answer — the raw rows and the owner's login
 * — not the split: the split is recomputed from the desk config on every call, so hiding a PR
 * or recording an intent shows on the very next request without waiting out the cache.
 * Concurrent calls during a refresh share one `gh` run rather than starting one each.
 *
 * Failures are answers, never blanks. With no repo, or no `gh`, or `gh` failing, the result
 * carries an `error` sentence and empty lists, and the page shows the sentence. A failed
 * refresh is cached for the same span as a good one, so a desk with no `gh` does not spawn a
 * failing process on every poll.
 *
 * @param deps `run` (a command runner, see {@link ghRunner}), `readConfig` (returns the parsed
 *             desk config, `{}` when absent), `env` (the `SELF_EXPRESSION_DESK_REPO` value),
 *             `now` (milliseconds clock), `ttlMs` (cache span), `whoami` (the owner lookup,
 *             default a fresh {@link createViewerLookup} over `run`; pass one shared with the
 *             issue feed so the owner is looked up once per server)
 * @returns `{ get, invalidate }`: `get()` resolves to
 *          `{ repo, viewer, mine, theirs, error, warning, fetchedAt }`; `invalidate()` makes
 *          the next `get()` ask GitHub again
 *
 * @example
 * const feed = createPullRequestFeed({ run: ghRunner(), readConfig, env: undefined });
 * await feed.get();
 * // { repo: 'StoneCypher/self-expression', viewer: 'StoneCypher',
 * //   mine: [{ number: 135, … }], theirs: [], error: null, warning: null, fetchedAt: … }
 * @see createIssueFeed — the same caching, for the ticket rail
 */
export function createPullRequestFeed({ run, readConfig, env, now = Date.now, ttlMs = PR_TTL_MS,
                                        whoami = createViewerLookup(run) }) {
  const cache = createRepoCache({ now, ttlMs, refresh: async repo => {
    const { rows, error } = await listRows(run, ['pr', 'list', '--repo', repo, '--state', 'open',
                                                 '--limit', '50', '--json', PR_FIELDS], 'gh pr list');
    if (error !== null) return { rows, viewer: null, error, warning: null };
    const viewer = await whoami();
    return { rows, viewer, error: null,
             warning: viewer === null
               ? 'could not tell who you are on GitHub, so every pull request is listed as someone else\'s'
               : null };
  } });

  async function get() {
    const cfg = readConfig();
    const { repo, problem } = resolveRepo(env, cfg);
    if (repo === null) {
      return { repo: null, viewer: null, mine: [], theirs: [], error: problem, warning: null, fetchedAt: null };
    }
    const entry = await cache.get(repo);
    const split = splitPullRequests(entry.rows, { viewer: entry.viewer, cfg });
    return { repo, viewer: entry.viewer, ...split, error: entry.error, warning: entry.warning,
             fetchedAt: new Date(entry.at).toISOString() };
  }

  return { get, invalidate: cache.invalidate };
}

/**
 * The labels that put an open issue in the ticket rail, when `desk-config.json` names none.
 *
 * Each marks an issue that is waiting on the owner rather than on the work: a question to
 * answer, a decision to make, something to look into. Matched without regard to case, since
 * trackers are inconsistent about it (`Needs answers` beside `needs owner`).
 */
export const DEFAULT_TICKET_LABELS = Object.freeze(['Question', 'Needs answers', 'needs owner', 'Needs research']);

/** How many tracker tickets the rail shows at once when the config does not say. */
export const DEFAULT_TICKET_LIMIT = 8;

/** What the owner can ask for a ticket: the same three verbs the rail offers a hand-written one. */
export const TICKET_ACTIONS = Object.freeze(['next', 'agents', 'drop']);

/** How long one `gh issue list` answer is reused, in milliseconds; the same minute as the PRs. */
export const ISSUE_TTL_MS = PR_TTL_MS;

/** The fields `gh issue list` is asked for — every one the ticket rail reads, and no others. */
const ISSUE_FIELDS = 'number,title,url,labels,assignees';

/** Exactly a GitHub issue permalink — not a pull request's, which the PR lists already carry. */
const ISSUE_PERMALINK = /^https:\/\/github\.com\/[\w.-]{1,39}\/[\w.-]{1,100}\/issues\/\d{1,7}$/;

/**
 * The labels that qualify an issue for the ticket rail on this desk.
 *
 * `desk-config.json`'s `ticketLabels` when it is a list, else {@link DEFAULT_TICKET_LABELS}.
 * An empty list is a real choice — "only issues assigned to me" — and is kept, not defaulted.
 * Non-strings and blanks are dropped, and so are repeats that differ only in case.
 *
 * @param cfg the parsed desk config
 * @returns the label names, trimmed, in the order written
 *
 * @example
 * ticketLabels({});                                   // ['Question', 'Needs answers', 'needs owner', 'Needs research']
 * ticketLabels({ ticketLabels: ['bug', ' BUG ', 3] }); // ['bug']
 * ticketLabels({ ticketLabels: [] });                 // []
 */
export function ticketLabels(cfg) {
  if (!Array.isArray(cfg?.ticketLabels)) return [...DEFAULT_TICKET_LABELS];
  const seen = new Set();
  return cfg.ticketLabels
    .filter(l => typeof l === 'string' && l.trim() !== '')
    .map(l => l.trim())
    .filter(l => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * How many tracker tickets the rail shows at once; the rest wait on the bench.
 *
 * @param cfg the parsed desk config, whose `ticketLimit` is consulted
 * @returns an integer from 0 to 50; {@link DEFAULT_TICKET_LIMIT} when unset or not an integer
 *
 * @example
 * ticketLimit({ ticketLimit: 3 });     // 3
 * ticketLimit({ ticketLimit: 'x' });   // 8
 * ticketLimit({ ticketLimit: 999 });   // 50
 */
export function ticketLimit(cfg) {
  const n = cfg?.ticketLimit;
  return Number.isInteger(n) && n >= 0 ? Math.min(50, n) : DEFAULT_TICKET_LIMIT;
}

/**
 * The tracker tickets dropped from this desk, as a set of issue permalinks.
 *
 * @param cfg the parsed desk config, whose `ticketHidden` is consulted
 * @returns the permalinks; anything that is not an exact issue permalink is ignored
 *
 * @example
 * hiddenTickets({ ticketHidden: ['https://github.com/o/r/issues/4', 'junk'] });
 * // Set { 'https://github.com/o/r/issues/4' }
 */
export function hiddenTickets(cfg) {
  const list = Array.isArray(cfg?.ticketHidden) ? cfg.ticketHidden : [];
  return new Set(list.filter(u => typeof u === 'string' && ISSUE_PERMALINK.test(u)));
}

/**
 * The issue permalink a hand-written `questions.json` row points at, if any.
 *
 * The same rule the page uses to link a ticket's number: the row's own `url` when it is a
 * valid permalink, otherwise its leading `#N` resolved against the desk's repo, otherwise
 * nothing. Used to recognise a tracker issue that is already on the desk by hand.
 *
 * @param row  one `questions.json` row
 * @param repo the desk's repo, or null
 * @returns the permalink, or `null`
 *
 * @example
 * ticketPermalink({ text: '#134 restore the inbox' }, 'o/r');   // 'https://github.com/o/r/issues/134'
 * ticketPermalink({ text: '#134 restore the inbox' }, null);    // null
 */
export function ticketPermalink(row, repo) {
  if (isIssueUrl(row?.url)) return row.url;
  const m = /^#(\d{1,7})\s/.exec(typeof row?.text === 'string' ? row.text : '');
  return m && repo ? `https://github.com/${repo}/issues/${m[1]}` : null;
}

/**
 * Choose the tracker issues that belong in the ticket rail, and in what order.
 *
 * An open issue qualifies when it is assigned to the owner or carries one of the desk's
 * {@link ticketLabels}. It is then left out when the owner dropped it (`ticketHidden`) or when
 * a hand-written ticket row already points at the same permalink — each issue appears once,
 * and the hand-written row wins because someone put it there on purpose. What remains keeps
 * `gh`'s order (newest first); the first {@link ticketLimit} are shown and the rest are the
 * bench, which is how dropping a ticket promotes the next one without anything being moved.
 *
 * With no `viewer`, assignment cannot be known, so only labels qualify.
 *
 * @param rows the parsed `gh issue list --json …` array; malformed entries are skipped
 * @param opts `viewer` (the owner's login, or null), `cfg` (the desk config), `repo` (for rows
 *             without a usable `url`), `handWritten` (permalinks already on the desk by hand)
 * @returns `{ tickets, bench }`: the rows to show, each `{ number, title, url, labels,
 *          assigned, intent }` with `labels` the qualifying ones only, and how many more wait
 *
 * @example
 * selectTickets([{ number: 9, title: 'which?', url: 'https://github.com/o/r/issues/9',
 *                  labels: [{ name: 'question' }], assignees: [] }],
 *               { viewer: 'me', cfg: {}, repo: 'o/r', handWritten: new Set() });
 * // { tickets: [{ number: 9, title: 'which?', url: 'https://github.com/o/r/issues/9',
 * //               labels: ['question'], assigned: false, intent: null }], bench: 0 }
 */
export function selectTickets(rows, { viewer, cfg, repo, handWritten }) {
  const wanted = new Set(ticketLabels(cfg).map(l => l.toLowerCase()));
  const hidden = hiddenTickets(cfg);
  const intent = cfg?.ticketIntent && typeof cfg.ticketIntent === 'object' ? cfg.ticketIntent : {};
  const seen   = new Set();
  const picked = [];

  for (const issue of Array.isArray(rows) ? rows : []) {
    if (!issue || !Number.isInteger(issue.number) || issue.number <= 0) continue;
    const url = ISSUE_PERMALINK.test(issue.url ?? '') ? issue.url
              : repo ? `https://github.com/${repo}/issues/${issue.number}` : null;
    if (url === null || seen.has(url) || hidden.has(url) || handWritten?.has(url)) continue;

    const labels   = (Array.isArray(issue.labels) ? issue.labels : [])
                       .map(l => l?.name).filter(n => typeof n === 'string' && wanted.has(n.toLowerCase()));
    const assigned = viewer !== null && viewer !== undefined &&
                     (Array.isArray(issue.assignees) ? issue.assignees : []).some(a => a?.login === viewer);
    if (!assigned && labels.length === 0) continue;

    seen.add(url);
    picked.push({
      number: issue.number,
      title:  typeof issue.title === 'string' ? issue.title : '',
      url, labels, assigned,
      intent: Object.hasOwn(intent, url) && TICKET_ACTIONS.includes(intent[url]) && intent[url] !== 'drop'
                ? intent[url] : null,
    });
  }
  const limit = ticketLimit(cfg);
  return { tickets: picked.slice(0, limit), bench: Math.max(0, picked.length - limit) };
}

/**
 * Record what the owner wants done with one tracker ticket, as a new desk config.
 *
 * Like {@link applyPrIntent}, this records and does nothing on GitHub. `next` and `agents`
 * are written to `ticketIntent` under the issue's permalink; `drop` adds the permalink to
 * `ticketHidden` and forgets its intent, and the issue stays open on GitHub. Keyed by
 * permalink rather than number because the number alone would collide across repos, and a
 * desk's repo can change.
 *
 * Pure: the input is not modified.
 *
 * @param cfg    the parsed desk config
 * @param url    the issue's permalink
 * @param action one of {@link TICKET_ACTIONS}
 * @returns the updated config, or `null` when the permalink or the action is not acceptable
 *
 * @example
 * applyTicketIntent({}, 'https://github.com/o/r/issues/9', 'agents');
 * // { ticketIntent: { 'https://github.com/o/r/issues/9': 'agents' } }
 * applyTicketIntent({}, 'https://github.com/o/r/pull/9', 'next');   // null — a PR, not an issue
 */
export function applyTicketIntent(cfg, url, action) {
  if (typeof url !== 'string' || !ISSUE_PERMALINK.test(url) || !TICKET_ACTIONS.includes(action)) return null;

  const next         = { ...cfg };
  const ticketIntent = { ...(cfg?.ticketIntent && typeof cfg.ticketIntent === 'object' ? cfg.ticketIntent : {}) };

  if (action === 'drop') {
    delete ticketIntent[url];
    next.ticketHidden = [...hiddenTickets(cfg).add(url)];
  } else {
    ticketIntent[url] = action;
  }
  next.ticketIntent = ticketIntent;
  return next;
}

/**
 * The inbox's ticket feed: `gh issue list`, cached, filtered to what waits on the owner.
 *
 * The tracker's half of the ticket rail; the hand-written half stays in `questions.json`.
 * Cached and coalesced exactly as {@link createPullRequestFeed} is, and for the same reasons:
 * what is cached is GitHub's answer, and the selection — labels, assignment, drops, intents,
 * the hand-written rows it must not repeat — is recomputed on every call, so a drop or an
 * edit to `questions.json` shows on the very next request.
 *
 * Failures are answers, never blanks: with no repo, no `gh`, or `gh` failing, `error` says
 * which and `tickets` is empty. When GitHub cannot say who the owner is, labelled issues are
 * still listed and `warning` says assigned ones cannot be.
 *
 * @param deps `run` (a command runner), `readConfig` (the parsed desk config), `readInbox`
 *             (returns `{ questions }` from `questions.json`), `env` (the
 *             `SELF_EXPRESSION_DESK_REPO` value), `now`, `ttlMs`, `whoami` (the owner lookup;
 *             share the PR feed's)
 * @returns `{ get, invalidate }`: `get()` resolves to
 *          `{ repo, viewer, tickets, bench, labels, error, warning, fetchedAt }`
 *
 * @example
 * const feed = createIssueFeed({ run: ghRunner(), readConfig, readInbox: inboxDoc, env: undefined });
 * await feed.get();
 * // { repo: 'StoneCypher/self-expression', viewer: 'StoneCypher',
 * //   tickets: [{ number: 137, title: 'Desk inbox: fill ticket rows…', url: '…/issues/137',
 * //               labels: [], assigned: true, intent: null }],
 * //   bench: 0, labels: ['Question', …], error: null, warning: null, fetchedAt: '…' }
 * @see selectTickets
 */
export function createIssueFeed({ run, readConfig, readInbox, env, now = Date.now, ttlMs = ISSUE_TTL_MS,
                                  whoami = createViewerLookup(run) }) {
  const cache = createRepoCache({ now, ttlMs, refresh: async repo => {
    const { rows, error } = await listRows(run, ['issue', 'list', '--repo', repo, '--state', 'open',
                                                 '--limit', '200', '--json', ISSUE_FIELDS], 'gh issue list');
    if (error !== null) return { rows, viewer: null, error, warning: null };
    const viewer = await whoami();
    return { rows, viewer, error: null,
             warning: viewer === null
               ? 'could not tell who you are on GitHub, so only labelled issues are listed, not ones assigned to you'
               : null };
  } });

  /** Permalinks of the hand-written ticket rows still on the desk; an unreadable inbox has none. */
  function handWritten(repo) {
    let questions = [];
    try { questions = readInbox()?.questions ?? []; } catch { /* nothing to deduplicate against */ }
    return new Set((Array.isArray(questions) ? questions : [])
      .filter(q => q?.kind === 'ticket' && !q.answer)
      .map(q => ticketPermalink(q, repo))
      .filter(u => u !== null));
  }

  async function get() {
    const cfg    = readConfig();
    const labels = ticketLabels(cfg);
    const { repo, problem } = resolveRepo(env, cfg);
    if (repo === null) {
      return { repo: null, viewer: null, tickets: [], bench: 0, labels, error: problem, warning: null, fetchedAt: null };
    }
    const entry = await cache.get(repo);
    const chosen = selectTickets(entry.rows, { viewer: entry.viewer, cfg, repo, handWritten: handWritten(repo) });
    return { repo, viewer: entry.viewer, ...chosen, labels, error: entry.error, warning: entry.warning,
             fetchedAt: new Date(entry.at).toISOString() };
  }

  return { get, invalidate: cache.invalidate };
}

/**
 * Read the inbox document out of `questions.json`'s text.
 *
 * `reserve` is the bench of ticket suggestions waiting behind the visible ones; it is carried
 * through every write so answering a question can never erase it.
 *
 * @param text the file's contents
 * @returns `{ questions, reserve }`, both arrays
 * @throws {SyntaxError} when the text is not JSON — the caller decides what a half-written
 *         file means (see `panel.mjs`, which serves the last good copy)
 *
 * @example
 * parseInbox('{"questions":[{"id":"a","text":"?"}]}');   // { questions: [{…}], reserve: [] }
 */
export function parseInbox(text) {
  const got = JSON.parse(text);
  return { questions: Array.isArray(got?.questions) ? got.questions : [],
           reserve:   Array.isArray(got?.reserve)   ? got.reserve   : [] };
}

/**
 * Apply one post from the inbox page to the inbox document.
 *
 * The rules, unchanged from the hand-written protocol and extended for tickets:
 *
 * - `action: 'drop'` removes the row outright — a deletion is a deletion, never a tombstone.
 *   Dropping a **ticket** promotes the next one off the `reserve` bench, so the ticket rail
 *   stays a fixed-size shortlist rather than a queue that drains; when the bench is empty the
 *   rail simply shrinks.
 * - `action: 'next' | 'agents'` sets `queued` and `queuedAt`; the row stays visible.
 * - `dismiss: true` retires an unanswered row as stale.
 * - `answer: '…'` answers an unanswered row, truncated to 200 characters.
 *
 * Answers are one-way and idempotent: a second answer to an answered row changes nothing.
 * Pure: the input is not modified.
 *
 * @param doc  `{ questions, reserve }`
 * @param post the parsed request body
 * @param at   the ISO timestamp to stamp
 * @returns `{ doc, event }` — the new document and a one-line log entry, or the same `doc`
 *          and `event: null` when the post changed nothing
 *
 * @example
 * applyInboxPost({ questions: [{ id: 'q', text: 'ok?' }], reserve: [] },
 *                { id: 'q', answer: 'yes' }, '2026-09-26T10:00:00.000Z');
 * // { doc: { questions: [{ id: 'q', text: 'ok?', answer: 'yes', answeredAt: '…' }], reserve: [] },
 * //   event: { action: 'question.answered', id: 'q', answer: 'yes', text: 'ok?' } }
 */
export function applyInboxPost(doc, post, at) {
  const questions = doc.questions ?? [], reserve = doc.reserve ?? [];
  const q = post && typeof post === 'object' ? questions.find(x => x.id === post.id) : undefined;
  if (!q) return { doc, event: null };

  if (post.action === 'drop') {
    const kept = questions.filter(x => x !== q), bench = [...reserve];
    const promoted = q.kind === 'ticket' && bench.length ? bench.shift() : null;
    if (promoted) kept.push(promoted);
    return { doc: { questions: kept, reserve: bench },
             event: { action: 'row.dropped', id: q.id, kind: q.kind ?? 'question', text: q.text,
                      promoted: promoted?.id ?? null } };
  }

  const swap = patch => questions.map(x => (x === q ? { ...x, ...patch } : x));

  if (post.action === 'next' || post.action === 'agents') {
    return { doc: { questions: swap({ queued: post.action, queuedAt: at }), reserve },
             event: { action: 'row.queued', id: q.id, queue: post.action, text: q.text } };
  }
  if (!q.answer && post.dismiss) {
    return { doc: { questions: swap({ answer: '(dismissed as stale)', dismissed: true, answeredAt: at }), reserve },
             event: { action: 'question.dismissed', id: q.id, text: q.text } };
  }
  if (!q.answer && typeof post.answer === 'string' && post.answer) {
    const answer = post.answer.slice(0, 200);
    return { doc: { questions: swap({ answer, answeredAt: at }), reserve },
             event: { action: 'question.answered', id: q.id, answer, text: q.text } };
  }
  return { doc, event: null };
}
