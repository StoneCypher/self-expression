/**
 * Tests for the desk inbox's logic (`src/scripts/desk/deskinbox.mjs`): the pull-request feed,
 * owner intents, permalink validation, the audit row, and the `questions.json` rules.
 *
 * `gh` is never run. The feed takes its command runner as an argument, so every test here
 * hands it a stub that answers from a script — canned JSON, a failure, a rejection — and
 * records what it was asked, which is what lets the caching and the argument list be checked
 * rather than assumed. `ghRunner` itself is exercised only against a program that does not
 * exist, which is the "gh missing" path and reaches no network. `openExternally` is only ever
 * given a stub launcher, so no browser opens from a test.
 */

import { describe, test, expect } from 'vitest';

import {
  ISSUE_URL, REPO_NAME, PR_ACTIONS, AI_LABEL,
  isIssueUrl, resolveRepo, hiddenPrs, splitPullRequests, applyPrIntent, auditRow, readAudit,
  openerFor, openExternally, ghFailure, ghRunner, createPullRequestFeed, parseInbox,
  applyInboxPost, createViewerLookup, createIssueFeed, selectTickets, applyTicketIntent,
  ticketLabels, ticketLimit, hiddenTickets, ticketPermalink,
  DEFAULT_TICKET_LABELS, DEFAULT_TICKET_LIMIT, TICKET_ACTIONS, ISSUE_TTL_MS, PR_TTL_MS,
  type Runner, type RunResult, type DeskConfig,
} from '../../scripts/desk/deskinbox.mjs';

/** A `gh pr list` row, with the fields the feed asks for. */
interface GhPr {
  number: number;
  title: string;
  author: { login: string };
  isDraft?: boolean;
  reviewDecision?: string;
  labels?: { name: string }[];
}

/**
 * A stub runner that answers `api user` with a login and `pr list` with rows, and records
 * every argv it was given.
 *
 * @param login the login `api user` reports, or null to make that call fail
 * @param rows  what `pr list` returns, or a RunResult to return verbatim
 * @returns the runner and the list of calls it has seen
 *
 * @example
 * const { run, calls } = stubGh('me', [{ number: 1, title: 't', author: { login: 'me' } }]);
 */
function stubGh(login: string | null, rows: GhPr[] | RunResult): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = args => {
    calls.push(args);
    if (args[0] === 'api') {
      return Promise.resolve(login === null ? { ok: false, error: 'gh failed: auth' }
                                            : { ok: true, stdout: `${login}\n` });
    }
    return Promise.resolve(Array.isArray(rows) ? { ok: true, stdout: JSON.stringify(rows) } : rows);
  };
  return { run, calls };
}

const pr = (number: number, login: string, extra: Partial<GhPr> = {}): GhPr =>
  ({ number, title: `pr ${String(number)}`, author: { login }, ...extra });

describe('isIssueUrl', () => {
  test.each([
    ['https://github.com/StoneCypher/self-expression/issues/134', true],
    ['https://github.com/StoneCypher/self-expression/pull/135', true],
    ['https://github.com/a/b/issues/1', true],
    ['http://github.com/a/b/issues/1', false],
    ['https://github.com/a/b/issues/1#x', false],
    ['https://github.com/a/b/issues/1/', false],
    ['https://github.com/a/b/commits/1', false],
    ['https://github.com.evil.example/a/b/issues/1', false],
    ['https://github.com/a/b/issues/12345678', false],
    ['file:///C:/Windows/System32', false],
    ['', false],
  ])('%s → %s', (url, ok) => {
    expect(isIssueUrl(url)).toBe(ok);
    expect(ISSUE_URL.test(url)).toBe(ok);
  });

  test('non-strings are never permalinks', () => {
    expect(isIssueUrl(undefined)).toBe(false);
    expect(isIssueUrl(134)).toBe(false);
    expect(isIssueUrl({ toString: () => 'https://github.com/a/b/issues/1' })).toBe(false);
  });
});

describe('resolveRepo', () => {
  test('the environment wins over the desk config', () => {
    expect(resolveRepo('env/repo', { repo: 'cfg/repo' })).toEqual({ repo: 'env/repo', problem: null });
  });

  test('the desk config is used when the environment is unset or blank', () => {
    expect(resolveRepo(undefined, { repo: 'cfg/repo' })).toEqual({ repo: 'cfg/repo', problem: null });
    expect(resolveRepo('   ', { repo: 'cfg/repo' })).toEqual({ repo: 'cfg/repo', problem: null });
  });

  test('with neither there is no repo, and the problem says how to set one', () => {
    const got = resolveRepo(undefined, {});
    expect(got.repo).toBeNull();
    expect(got.problem).toMatch(/desk-config\.json/);
    expect(got.problem).toMatch(/SELF_EXPRESSION_DESK_REPO/);
  });

  test.each(['no-slash', 'a/b/c', '--repo=x/y', 'a/-flag', 'a b/c', 'a/b;rm', 'a/b\nc'])(
    'a malformed repo %j is refused, naming where it came from', bad => {
      const fromEnv = resolveRepo(bad, {});
      expect(fromEnv.repo).toBeNull();
      expect(fromEnv.problem).toMatch(/SELF_EXPRESSION_DESK_REPO is not an owner\/name pair/);
      const fromCfg = resolveRepo(undefined, { repo: bad });
      expect(fromCfg.repo).toBeNull();
      expect(fromCfg.problem).toMatch(/desk-config\.json's "repo"/);
    });

  test('a non-string config repo is refused rather than coerced', () => {
    expect(resolveRepo(undefined, { repo: 42 }).repo).toBeNull();
  });

  test('REPO_NAME admits the ordinary shapes', () => {
    expect(REPO_NAME.test('StoneCypher/self-expression')).toBe(true);
    expect(REPO_NAME.test('a.b/c_d-e.f')).toBe(true);
  });
});

describe('splitPullRequests', () => {
  test('splits by the author login, keeping gh order within each list', () => {
    const got = splitPullRequests([pr(3, 'me'), pr(2, 'you'), pr(1, 'me')], { viewer: 'me', cfg: {} });
    expect(got.mine.map(p => p.number)).toEqual([3, 1]);
    expect(got.theirs.map(p => p.number)).toEqual([2]);
  });

  test('an AI label tints the row but never moves it between lists', () => {
    const labels = [{ name: AI_LABEL }];
    const got = splitPullRequests([pr(1, 'me', { labels }), pr(2, 'you', { labels })], { viewer: 'me', cfg: {} });
    expect(got.mine).toEqual([expect.objectContaining({ number: 1, ai: true })]);
    expect(got.theirs).toEqual([expect.objectContaining({ number: 2, ai: true })]);
  });

  test('with no viewer every PR is someone else\'s', () => {
    const got = splitPullRequests([pr(1, 'me'), pr(2, 'you')], { viewer: null, cfg: {} });
    expect(got.mine).toEqual([]);
    expect(got.theirs.map(p => p.number)).toEqual([1, 2]);
  });

  test('hidden PRs are left out, including numbers written as strings', () => {
    const got = splitPullRequests([pr(1, 'me'), pr(2, 'me'), pr(3, 'you')],
                                  { viewer: 'me', cfg: { prHidden: [2, '3', 'junk'] } });
    expect(got.mine.map(p => p.number)).toEqual([1]);
    expect(got.theirs).toEqual([]);
  });

  test('carries draft, review and a recorded intent; an unknown intent reads as none', () => {
    const got = splitPullRequests(
      [pr(1, 'me', { isDraft: true, reviewDecision: 'APPROVED' }), pr(2, 'me')],
      { viewer: 'me', cfg: { prIntent: { 1: 'land', 2: 'explode' } } });
    expect(got.mine).toEqual([
      { number: 1, title: 'pr 1', draft: true, review: 'APPROVED', ai: false, intent: 'land' },
      { number: 2, title: 'pr 2', draft: false, review: null, ai: false, intent: null },
    ]);
  });

  test('malformed rows and a non-array are skipped rather than thrown on', () => {
    expect(splitPullRequests({ not: 'a list' }, { viewer: 'me', cfg: {} })).toEqual({ mine: [], theirs: [] });
    const got = splitPullRequests([null, { title: 'no number' }, { number: 1.5 }, pr(4, 'me')],
                                  { viewer: 'me', cfg: {} });
    expect(got.mine.map(p => p.number)).toEqual([4]);
  });
});

describe('applyPrIntent', () => {
  test('land and agent are recorded; nothing else in the config changes', () => {
    const cfg: DeskConfig = { name: 'd', hidden: ['weather'] };
    expect(applyPrIntent(cfg, 12, 'land')).toEqual({ name: 'd', hidden: ['weather'], prIntent: { 12: 'land' } });
    expect(applyPrIntent({ prIntent: { 12: 'land' } }, '12', 'agent')).toEqual({ prIntent: { 12: 'agent' } });
  });

  test('drop hides the PR and forgets its intent', () => {
    expect(applyPrIntent({ prIntent: { 12: 'land', 13: 'agent' }, prHidden: [9] }, 12, 'drop'))
      .toEqual({ prIntent: { 13: 'agent' }, prHidden: [9, 12] });
  });

  test('dropping twice hides once', () => {
    const once = applyPrIntent({}, 5, 'drop');
    expect(once).not.toBeNull();
    expect(applyPrIntent(once as DeskConfig, 5, 'drop')?.prHidden).toEqual([5]);
  });

  test('does not modify its input', () => {
    const cfg: DeskConfig = { prIntent: { 1: 'land' }, prHidden: [2] };
    const before = structuredClone(cfg);
    applyPrIntent(cfg, 1, 'drop');
    applyPrIntent(cfg, 3, 'agent');
    expect(cfg).toEqual(before);
  });

  test.each([
    [12, 'merge'], [12, undefined], [0, 'land'], [-3, 'land'], [1.5, 'land'], ['x', 'land'], [null, 'land'],
  ])('refuses number %j with action %j', (n, action) => {
    expect(applyPrIntent({}, n, action)).toBeNull();
  });

  test('PR_ACTIONS is exactly the three verbs', () => {
    expect([...PR_ACTIONS]).toEqual(['land', 'agent', 'drop']);
  });
});

describe('auditRow and readAudit', () => {
  test('the stamp is applied after the detail, so a detail cannot relabel its row', () => {
    expect(auditRow('pr.intent', { number: 1, action: 'spoof', at: 'then' }, 'now'))
      .toEqual({ number: 1, action: 'pr.intent', at: 'now' });
  });

  test('reads the newest rows, oldest first, and reports unparseable lines', () => {
    const text = '{"action":"a"}\n{"action":"b"}\nnot json\n{"action":"c"}\n';
    expect(readAudit(text, 2)).toEqual({ rows: [{ at: null, action: 'unparseable', raw: 'not json' }, { action: 'c' }], showing: 2 });
    expect(readAudit(text).showing).toBe(4);
    expect(readAudit('', 10)).toEqual({ rows: [], showing: 0 });
  });

  test('clamps the count to 1..500 and treats nonsense as the default', () => {
    const text = Array.from({ length: 600 }, (_, i) => JSON.stringify({ i })).join('\n');
    expect(readAudit(text, 10_000).showing).toBe(500);
    expect(readAudit(text, Number.NaN).showing).toBe(100);
    expect(readAudit(text, -4).showing).toBe(100);
  });
});

describe('openExternally', () => {
  test('hands an exact permalink to the platform opener and audits it', () => {
    const launched: [string, string[]][] = [], audited: [string, Record<string, unknown>][] = [];
    const url = 'https://github.com/StoneCypher/self-expression/issues/134';
    const ok = openExternally(url, { launch: (c, a) => { launched.push([c, a]); },
                                     audit: (a, d) => { audited.push([a, d]); }, platform: 'win32' });
    expect(ok).toBe(true);
    expect(launched).toEqual([['explorer.exe', [url]]]);
    expect(audited).toEqual([['open.allowed', { url, via: 'explorer.exe' }]]);
  });

  test('refuses anything else, launches nothing, and audits the refusal', () => {
    const launched: unknown[] = [], audited: string[] = [];
    for (const bad of ['file:///C:/Windows', 'https://example.com/', undefined, 42]) {
      expect(openExternally(bad, { launch: () => { launched.push(bad); },
                                   audit: a => { audited.push(a); } })).toBe(false);
    }
    expect(launched).toEqual([]);
    expect(audited).toEqual(['open.refused', 'open.refused', 'open.refused', 'open.refused']);
  });

  test('picks the opener by platform', () => {
    expect(openerFor('win32', 'u')).toEqual(['explorer.exe', ['u']]);
    expect(openerFor('darwin', 'u')).toEqual(['open', ['u']]);
    expect(openerFor('linux', 'u')).toEqual(['xdg-open', ['u']]);
  });
});

describe('ghFailure and ghRunner', () => {
  test('a missing binary says so, by name', () => {
    expect(ghFailure({ code: 'ENOENT' }, '', 'gh')).toBe('gh is not installed or not on PATH (gh)');
  });

  test('otherwise the first line of stderr, then of the error message', () => {
    expect(ghFailure(new Error('exit 1'), 'HTTP 401: Bad credentials\nmore', 'gh')).toBe('gh failed: HTTP 401: Bad credentials');
    expect(ghFailure(new Error('Command failed\nmore'), '', 'gh')).toBe('gh failed: Command failed');
  });

  test('running a gh that does not exist answers with an error instead of rejecting', async () => {
    const got = await ghRunner('se-no-such-gh-binary-134')(['--version']);
    expect(got).toEqual({ ok: false, error: 'gh is not installed or not on PATH (se-no-such-gh-binary-134)' });
  });
});

describe('createPullRequestFeed', () => {
  /** A controllable clock. */
  function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
    let t = start;
    return { now: () => t, advance: ms => { t += ms; } };
  }

  test('asks gh for the configured repo\'s open PRs and splits them', async () => {
    const { run, calls } = stubGh('me', [pr(1, 'me'), pr(2, 'you')]);
    const feed = createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined });
    const got = await feed.get();
    expect(got.repo).toBe('o/r');
    expect(got.viewer).toBe('me');
    expect(got.error).toBeNull();
    expect(got.warning).toBeNull();
    expect(got.mine.map(p => p.number)).toEqual([1]);
    expect(got.theirs.map(p => p.number)).toEqual([2]);
    expect(calls).toContainEqual(['pr', 'list', '--repo', 'o/r', '--state', 'open', '--limit', '50',
                                  '--json', 'number,title,author,isDraft,reviewDecision,labels']);
  });

  test('with no repo it runs nothing and says so', async () => {
    const { run, calls } = stubGh('me', []);
    const got = await createPullRequestFeed({ run, readConfig: () => ({}), env: undefined }).get();
    expect(calls).toEqual([]);
    expect(got).toEqual(expect.objectContaining({ repo: null, mine: [], theirs: [] }));
    expect(got.error).toMatch(/no repo configured/);
  });

  test('gh missing: the error is carried, the lists are empty, and nothing throws', async () => {
    const { run } = stubGh('me', { ok: false, error: 'gh is not installed or not on PATH (gh)' });
    const got = await createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined }).get();
    expect(got).toEqual(expect.objectContaining({ repo: 'o/r', mine: [], theirs: [],
                                                  error: 'gh is not installed or not on PATH (gh)' }));
  });

  test('gh answering with something that is not a list is an error, not an empty inbox', async () => {
    const { run } = stubGh('me', { ok: true, stdout: 'Welcome to GitHub CLI' });
    const got = await createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined }).get();
    expect(got.error).toMatch(/not a list/);
  });

  test('a runner that rejects becomes an error row rather than a failed request', async () => {
    const run: Runner = () => Promise.reject(new Error('spawn exploded\nstack'));
    const got = await createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined }).get();
    expect(got.error).toBe('gh failed: spawn exploded');
  });

  test('an unknown viewer lists everything as someone else\'s, with a warning', async () => {
    const { run } = stubGh(null, [pr(1, 'me')]);
    const got = await createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined }).get();
    expect(got.mine).toEqual([]);
    expect(got.theirs.map(p => p.number)).toEqual([1]);
    expect(got.warning).toMatch(/someone else's/);
    expect(got.error).toBeNull();
  });

  test('caches gh\'s answer for the TTL, then asks again', async () => {
    const { run, calls } = stubGh('me', [pr(1, 'me')]);
    const c = clock();
    const feed = createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined,
                                        now: c.now, ttlMs: 1000 });
    await feed.get();
    await feed.get();
    c.advance(999);
    await feed.get();
    const lists = () => calls.filter(a => a[0] === 'pr').length;
    expect(lists()).toBe(1);
    c.advance(1);
    await feed.get();
    expect(lists()).toBe(2);
    /* The owner's login is looked up once and kept. */
    expect(calls.filter(a => a[0] === 'api').length).toBe(1);
  });

  test('failures are cached too, so a desk with no gh does not spawn on every poll', async () => {
    const { run, calls } = stubGh('me', { ok: false, error: 'gh failed: x' });
    const feed = createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined,
                                        now: clock().now, ttlMs: 1000 });
    await feed.get();
    await feed.get();
    expect(calls.length).toBe(1);
  });

  test('concurrent calls during a refresh share one gh run', async () => {
    const { run, calls } = stubGh('me', [pr(1, 'me')]);
    const feed = createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined });
    const all = await Promise.all([feed.get(), feed.get(), feed.get()]);
    expect(calls.filter(a => a[0] === 'pr').length).toBe(1);
    for (const got of all) expect(got.mine.map(p => p.number)).toEqual([1]);
  });

  test('hiding a PR or recording an intent shows at once, without waiting out the cache', async () => {
    const { run, calls } = stubGh('me', [pr(1, 'me'), pr(2, 'me')]);
    let cfg: DeskConfig = { repo: 'o/r' };
    const feed = createPullRequestFeed({ run, readConfig: () => cfg, env: undefined, now: clock().now });
    expect((await feed.get()).mine.map(p => p.number)).toEqual([1, 2]);
    cfg = applyPrIntent(applyPrIntent(cfg, 1, 'drop') as DeskConfig, 2, 'land') as DeskConfig;
    const got = await feed.get();
    expect(got.mine).toEqual([expect.objectContaining({ number: 2, intent: 'land' })]);
    expect(calls.filter(a => a[0] === 'pr').length).toBe(1);
  });

  test('changing the repo refetches; invalidate refetches', async () => {
    const { run, calls } = stubGh('me', []);
    let cfg: DeskConfig = { repo: 'o/one' };
    const feed = createPullRequestFeed({ run, readConfig: () => cfg, env: undefined, now: clock().now });
    await feed.get();
    cfg = { repo: 'o/two' };
    await feed.get();
    feed.invalidate();
    await feed.get();
    expect(calls.filter(a => a[0] === 'pr').map(a => a[3])).toEqual(['o/one', 'o/two', 'o/two']);
  });

  test('the environment repo overrides the config', async () => {
    const { run, calls } = stubGh('me', []);
    const got = await createPullRequestFeed({ run, readConfig: () => ({ repo: 'cfg/r' }), env: 'env/r' }).get();
    expect(got.repo).toBe('env/r');
    expect(calls.find(a => a[0] === 'pr')?.[3]).toBe('env/r');
  });
});

describe('parseInbox', () => {
  test('reads questions and the reserve bench, defaulting both', () => {
    expect(parseInbox('{"questions":[{"id":"a"}],"reserve":[{"id":"r"}]}'))
      .toEqual({ questions: [{ id: 'a' }], reserve: [{ id: 'r' }] });
    expect(parseInbox('{}')).toEqual({ questions: [], reserve: [] });
    expect(parseInbox('null')).toEqual({ questions: [], reserve: [] });
  });

  test('throws on a half-written file, so the caller can serve the last good copy', () => {
    expect(() => parseInbox('{"questions":[')).toThrow(SyntaxError);
  });
});

describe('applyInboxPost', () => {
  const AT = '2026-09-26T10:00:00.000Z';
  const base = () => ({
    questions: [
      { id: 'q', text: 'ok?' },
      { id: 't', kind: 'task', text: 'do it' },
      { id: 'k', kind: 'ticket', text: '#134 restore the inbox' },
      { id: 'done', text: 'old', answer: 'yes' },
    ] as Record<string, unknown>[],
    reserve: [{ id: 'r1', kind: 'ticket', text: '#140 next' }, { id: 'r2', kind: 'ticket', text: '#141 after' }] as Record<string, unknown>[],
  });

  test('an answer is recorded, truncated, and keeps the reserve', () => {
    const { doc, event } = applyInboxPost(base(), { id: 'q', answer: 'x'.repeat(300) }, AT);
    expect(doc.questions[0]).toEqual({ id: 'q', text: 'ok?', answer: 'x'.repeat(200), answeredAt: AT });
    expect(doc.reserve).toHaveLength(2);
    expect(event?.action).toBe('question.answered');
  });

  test('answers are one-way: an answered row does not change', () => {
    const start = base();
    const { doc, event } = applyInboxPost(start, { id: 'done', answer: 'no' }, AT);
    expect(doc).toBe(start);
    expect(event).toBeNull();
  });

  test('dismiss retires an unanswered row as stale', () => {
    const { doc } = applyInboxPost(base(), { id: 'q', dismiss: true }, AT);
    expect(doc.questions[0]).toEqual({ id: 'q', text: 'ok?', answer: '(dismissed as stale)', dismissed: true, answeredAt: AT });
  });

  test('next and agents queue a row and leave it visible', () => {
    const { doc, event } = applyInboxPost(base(), { id: 't', action: 'agents' }, AT);
    expect(doc.questions[1]).toEqual({ id: 't', kind: 'task', text: 'do it', queued: 'agents', queuedAt: AT });
    expect(event).toEqual(expect.objectContaining({ action: 'row.queued', queue: 'agents' }));
  });

  test('dropping a task deletes it and promotes nothing', () => {
    const { doc, event } = applyInboxPost(base(), { id: 't', action: 'drop' }, AT);
    expect(doc.questions.map(q => q['id'])).toEqual(['q', 'k', 'done']);
    expect(doc.reserve).toHaveLength(2);
    expect(event).toEqual(expect.objectContaining({ action: 'row.dropped', promoted: null }));
  });

  test('dropping a ticket promotes the next one off the bench', () => {
    const { doc, event } = applyInboxPost(base(), { id: 'k', action: 'drop' }, AT);
    expect(doc.questions.map(q => q['id'])).toEqual(['q', 't', 'done', 'r1']);
    expect(doc.reserve.map(q => q['id'])).toEqual(['r2']);
    expect(event).toEqual(expect.objectContaining({ promoted: 'r1' }));
  });

  test('with an empty bench the rail simply shrinks', () => {
    const start = { ...base(), reserve: [] };
    const { doc } = applyInboxPost(start, { id: 'k', action: 'drop' }, AT);
    expect(doc.questions.map(q => q['id'])).toEqual(['q', 't', 'done']);
    expect(doc.reserve).toEqual([]);
  });

  test.each([[undefined], [null], ['text'], [{ id: 'missing', answer: 'x' }], [{ id: 'q', answer: '' }], [{ id: 'q' }]])(
    'a post that names nothing or asks nothing changes nothing: %j', post => {
      const start = base();
      expect(applyInboxPost(start, post, AT)).toEqual({ doc: start, event: null });
    });

  test('does not modify its input', () => {
    const start = base(), before = structuredClone(start);
    applyInboxPost(start, { id: 'q', answer: 'yes' }, AT);
    applyInboxPost(start, { id: 'k', action: 'drop' }, AT);
    applyInboxPost(start, { id: 't', action: 'next' }, AT);
    expect(start).toEqual(before);
  });
});

/** A `gh issue list` row, with the fields the ticket feed asks for. */
interface GhIssue {
  number: number;
  title: string;
  url?: string;
  labels?: { name: string }[];
  assignees?: { login: string }[];
}

const ISSUE_BASE = 'https://github.com/o/r/issues/';

const issue = (number: number, extra: Partial<GhIssue> = {}): GhIssue =>
  ({ number, title: `issue ${String(number)}`, url: ISSUE_BASE + String(number), labels: [], assignees: [], ...extra });

const labelled = (number: number, ...names: string[]): GhIssue => issue(number, { labels: names.map(name => ({ name })) });

/**
 * A stub runner that answers `api user` with a login and `issue list` with rows, and records
 * every argv it was given.
 *
 * @param login the login `api user` reports, or null to make that call fail
 * @param rows  what `issue list` returns, or a RunResult to return verbatim
 * @returns the runner and the list of calls it has seen
 *
 * @example
 * const { run, calls } = stubIssues('me', [labelled(1, 'Question')]);
 */
function stubIssues(login: string | null, rows: GhIssue[] | RunResult): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = args => {
    calls.push(args);
    if (args[0] === 'api') {
      return Promise.resolve(login === null ? { ok: false, error: 'gh failed: auth' }
                                            : { ok: true, stdout: `${login}\n` });
    }
    return Promise.resolve(Array.isArray(rows) ? { ok: true, stdout: JSON.stringify(rows) } : rows);
  };
  return { run, calls };
}

describe('ticketLabels, ticketLimit, hiddenTickets', () => {
  test('the defaults are the four owner-waiting labels and eight rows', () => {
    expect(ticketLabels({})).toEqual(['Question', 'Needs answers', 'needs owner', 'Needs research']);
    expect(ticketLabels(undefined)).toEqual([...DEFAULT_TICKET_LABELS]);
    expect(ticketLimit({})).toBe(DEFAULT_TICKET_LIMIT);
    expect(DEFAULT_TICKET_LIMIT).toBe(8);
  });

  test('a configured list replaces the defaults, trimmed, without blanks or case-only repeats', () => {
    expect(ticketLabels({ ticketLabels: ['bug', ' BUG ', 3, '', '  ', 'triage'] })).toEqual(['bug', 'triage']);
  });

  test('an empty list is kept: only assigned issues qualify', () => {
    expect(ticketLabels({ ticketLabels: [] })).toEqual([]);
  });

  test('a non-list ticketLabels falls back to the defaults', () => {
    expect(ticketLabels({ ticketLabels: 'Question' as unknown as unknown[] })).toEqual([...DEFAULT_TICKET_LABELS]);
  });

  test.each([[3, 3], [0, 0], [50, 50], [999, 50], [-1, 8], [2.5, 8], ['4', 8], [null, 8]])(
    'ticketLimit %j → %j', (given, want) => {
      expect(ticketLimit({ ticketLimit: given })).toBe(want);
    });

  test('hiddenTickets keeps exact issue permalinks only', () => {
    expect(hiddenTickets({ ticketHidden: [`${ISSUE_BASE}4`, 'https://github.com/o/r/pull/5', 'junk', 7] }))
      .toEqual(new Set([`${ISSUE_BASE}4`]));
    expect(hiddenTickets(undefined)).toEqual(new Set());
  });
});

describe('ticketPermalink', () => {
  test('a row\'s own valid url wins over its number', () => {
    expect(ticketPermalink({ text: '#1 x', url: 'https://github.com/a/b/issues/712' }, 'o/r'))
      .toBe('https://github.com/a/b/issues/712');
  });

  test('otherwise the leading #N resolves against the repo', () => {
    expect(ticketPermalink({ text: '#134 restore the inbox' }, 'o/r')).toBe(`${ISSUE_BASE}134`);
  });

  test('with no repo, no number, or a bad url there is no permalink', () => {
    expect(ticketPermalink({ text: '#134 restore the inbox' }, null)).toBeNull();
    expect(ticketPermalink({ text: 'no number here' }, 'o/r')).toBeNull();
    expect(ticketPermalink({ text: 'x', url: 'file:///C:/x' }, 'o/r')).toBeNull();
    expect(ticketPermalink(null, 'o/r')).toBeNull();
  });
});

describe('selectTickets', () => {
  const opts = (extra: Partial<Parameters<typeof selectTickets>[1]> = {}) =>
    ({ viewer: 'me', cfg: {}, repo: 'o/r', handWritten: new Set<string>(), ...extra });

  test('an issue with a default label qualifies, matched without regard to case', () => {
    const got = selectTickets([labelled(1, 'question'), labelled(2, 'NEEDS OWNER'), labelled(3, 'bug')], opts());
    expect(got.tickets).toEqual([
      { number: 1, title: 'issue 1', url: `${ISSUE_BASE}1`, labels: ['question'], assigned: false, intent: null },
      { number: 2, title: 'issue 2', url: `${ISSUE_BASE}2`, labels: ['NEEDS OWNER'], assigned: false, intent: null },
    ]);
    expect(got.bench).toBe(0);
  });

  test('an issue assigned to the owner qualifies without a label', () => {
    const got = selectTickets([issue(1, { assignees: [{ login: 'me' }] }), issue(2, { assignees: [{ login: 'you' }] })], opts());
    expect(got.tickets).toEqual([expect.objectContaining({ number: 1, assigned: true, labels: [] })]);
  });

  test('with no viewer only labels qualify', () => {
    const got = selectTickets([issue(1, { assignees: [{ login: 'me' }] }), labelled(2, 'Question')], opts({ viewer: null }));
    expect(got.tickets.map(t => t.number)).toEqual([2]);
    expect(got.tickets[0]?.assigned).toBe(false);
  });

  test('only the qualifying labels are reported', () => {
    const got = selectTickets([labelled(1, 'bug', 'Question', 'docs')], opts());
    expect(got.tickets[0]?.labels).toEqual(['Question']);
  });

  test('a configured label set replaces the defaults', () => {
    const got = selectTickets([labelled(1, 'Question'), labelled(2, 'triage')], opts({ cfg: { ticketLabels: ['Triage'] } }));
    expect(got.tickets.map(t => t.number)).toEqual([2]);
  });

  test('dropped issues are left out', () => {
    const got = selectTickets([labelled(1, 'Question'), labelled(2, 'Question')],
                              opts({ cfg: { ticketHidden: [`${ISSUE_BASE}1`] } }));
    expect(got.tickets.map(t => t.number)).toEqual([2]);
  });

  test('an issue already on the desk by hand is not listed twice', () => {
    const got = selectTickets([labelled(1, 'Question'), labelled(2, 'Question')],
                              opts({ handWritten: new Set([`${ISSUE_BASE}2`]) }));
    expect(got.tickets.map(t => t.number)).toEqual([1]);
  });

  test('a repeated permalink appears once', () => {
    const got = selectTickets([labelled(1, 'Question'), labelled(1, 'Question')], opts());
    expect(got.tickets).toHaveLength(1);
  });

  test('the limit shows the first rows in gh order and benches the rest', () => {
    const rows = [5, 4, 3, 2, 1].map(n => labelled(n, 'Question'));
    const got = selectTickets(rows, opts({ cfg: { ticketLimit: 2 } }));
    expect(got.tickets.map(t => t.number)).toEqual([5, 4]);
    expect(got.bench).toBe(3);
  });

  test('dropping a shown ticket promotes the next one off the bench', () => {
    const rows = [5, 4, 3].map(n => labelled(n, 'Question'));
    const cfg = applyTicketIntent({ ticketLimit: 2 }, `${ISSUE_BASE}5`, 'drop') as DeskConfig;
    const got = selectTickets(rows, opts({ cfg }));
    expect(got.tickets.map(t => t.number)).toEqual([4, 3]);
    expect(got.bench).toBe(0);
  });

  test('a recorded intent is carried; drop and unknown intents read as none', () => {
    const got = selectTickets([labelled(1, 'Question'), labelled(2, 'Question'), labelled(3, 'Question')],
      opts({ cfg: { ticketIntent: { [`${ISSUE_BASE}1`]: 'agents', [`${ISSUE_BASE}2`]: 'explode', [`${ISSUE_BASE}3`]: 'drop' } } }));
    expect(got.tickets.map(t => t.intent)).toEqual(['agents', null, null]);
  });

  test('a row without a usable url is linked from the repo, or skipped when there is none', () => {
    const row = labelled(9, 'Question');
    delete row.url;
    expect(selectTickets([row], opts()).tickets[0]?.url).toBe(`${ISSUE_BASE}9`);
    expect(selectTickets([row], opts({ repo: null })).tickets).toEqual([]);
    expect(selectTickets([{ ...labelled(9, 'Question'), url: 'https://github.com/o/r/pull/9' }], opts()).tickets[0]?.url)
      .toBe(`${ISSUE_BASE}9`);
  });

  test('malformed rows and a non-array are skipped rather than thrown on', () => {
    expect(selectTickets({ not: 'a list' }, opts())).toEqual({ tickets: [], bench: 0 });
    const got = selectTickets([null, { title: 'no number' }, { number: 0 }, { number: 1.5 },
                               { number: 3, labels: 'nope', assignees: 'nope' }, labelled(4, 'Question')], opts());
    expect(got.tickets.map(t => t.number)).toEqual([4]);
  });
});

describe('applyTicketIntent', () => {
  const url = `${ISSUE_BASE}9`;

  test('next and agents are recorded under the permalink; nothing else changes', () => {
    expect(applyTicketIntent({ name: 'd', prHidden: [3] }, url, 'next'))
      .toEqual({ name: 'd', prHidden: [3], ticketIntent: { [url]: 'next' } });
    expect(applyTicketIntent({ ticketIntent: { [url]: 'next' } }, url, 'agents')).toEqual({ ticketIntent: { [url]: 'agents' } });
  });

  test('drop hides the ticket, once, and forgets its intent', () => {
    const once = applyTicketIntent({ ticketIntent: { [url]: 'next' } }, url, 'drop');
    expect(once).toEqual({ ticketIntent: {}, ticketHidden: [url] });
    expect(applyTicketIntent(once as DeskConfig, url, 'drop')?.ticketHidden).toEqual([url]);
  });

  test('does not modify its input', () => {
    const cfg: DeskConfig = { ticketIntent: { [url]: 'next' }, ticketHidden: [] };
    const before = structuredClone(cfg);
    applyTicketIntent(cfg, url, 'drop');
    applyTicketIntent(cfg, `${ISSUE_BASE}10`, 'agents');
    expect(cfg).toEqual(before);
  });

  test.each([
    [url, 'land'], [url, undefined], ['https://github.com/o/r/pull/9', 'next'], ['file:///x', 'drop'],
    [`${url}#x`, 'next'], [9, 'next'], [null, 'drop'],
  ])('refuses %j with action %j', (u, action) => {
    expect(applyTicketIntent({}, u, action)).toBeNull();
  });

  test('TICKET_ACTIONS is exactly the rail\'s three verbs', () => {
    expect([...TICKET_ACTIONS]).toEqual(['next', 'agents', 'drop']);
  });
});

describe('createViewerLookup', () => {
  test('asks once, then remembers a success', async () => {
    const { run, calls } = stubIssues('me', []);
    const whoami = createViewerLookup(run);
    expect(await whoami()).toBe('me');
    expect(await whoami()).toBe('me');
    expect(calls).toEqual([['api', 'user', '--jq', '.login']]);
  });

  test('a failure is not remembered, so the next call asks again', async () => {
    const { run, calls } = stubIssues(null, []);
    const whoami = createViewerLookup(run);
    expect(await whoami()).toBeNull();
    expect(await whoami()).toBeNull();
    expect(calls).toHaveLength(2);
  });

  test('concurrent callers share one run', async () => {
    const { run, calls } = stubIssues('me', []);
    const whoami = createViewerLookup(run);
    expect(await Promise.all([whoami(), whoami(), whoami()])).toEqual(['me', 'me', 'me']);
    expect(calls).toHaveLength(1);
  });

  test('a runner that rejects reads as an unknown owner', async () => {
    const whoami = createViewerLookup(() => Promise.reject(new Error('boom')));
    expect(await whoami()).toBeNull();
  });

  test('one lookup shared by both feeds asks GitHub once', async () => {
    const calls: string[][] = [];
    const run: Runner = args => {
      calls.push(args);
      return Promise.resolve({ ok: true, stdout: args[0] === 'api' ? 'me' : '[]' });
    };
    const whoami = createViewerLookup(run);
    const readConfig = () => ({ repo: 'o/r' });
    await createPullRequestFeed({ run, readConfig, env: undefined, whoami }).get();
    await createIssueFeed({ run, readConfig, readInbox: () => ({ questions: [] }), env: undefined, whoami }).get();
    expect(calls.filter(a => a[0] === 'api')).toHaveLength(1);
  });
});

describe('createIssueFeed', () => {
  /** A controllable clock. */
  function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
    let t = start;
    return { now: () => t, advance: ms => { t += ms; } };
  }

  const noInbox = () => ({ questions: [] });

  test('asks gh for the configured repo\'s open issues and keeps the ones waiting on the owner', async () => {
    const { run, calls } = stubIssues('me', [labelled(3, 'Question'), issue(2, { assignees: [{ login: 'me' }] }), labelled(1, 'bug')]);
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined }).get();
    expect(got.repo).toBe('o/r');
    expect(got.viewer).toBe('me');
    expect(got.error).toBeNull();
    expect(got.warning).toBeNull();
    expect(got.tickets.map(t => t.number)).toEqual([3, 2]);
    expect(got.labels).toEqual([...DEFAULT_TICKET_LABELS]);
    expect(got.fetchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(calls).toContainEqual(['issue', 'list', '--repo', 'o/r', '--state', 'open', '--limit', '200',
                                  '--json', 'number,title,url,labels,assignees']);
  });

  test('with no repo it runs nothing and says so', async () => {
    const { run, calls } = stubIssues('me', []);
    const got = await createIssueFeed({ run, readConfig: () => ({}), readInbox: noInbox, env: undefined }).get();
    expect(calls).toEqual([]);
    expect(got).toEqual(expect.objectContaining({ repo: null, tickets: [], bench: 0, fetchedAt: null }));
    expect(got.error).toMatch(/no repo configured/);
  });

  test('gh missing: the error is carried, the rail is empty, and nothing throws', async () => {
    const { run } = stubIssues('me', { ok: false, error: 'gh is not installed or not on PATH (gh)' });
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined }).get();
    expect(got).toEqual(expect.objectContaining({ repo: 'o/r', tickets: [], bench: 0,
                                                  error: 'gh is not installed or not on PATH (gh)' }));
  });

  test('gh answering with something that is not a list is an error naming the command', async () => {
    const { run } = stubIssues('me', { ok: true, stdout: '{"message":"Not Found"}' });
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined }).get();
    expect(got.error).toBe('gh issue list returned something that is not a list');
  });

  test('a runner that rejects becomes an error rather than a failed request', async () => {
    const run: Runner = () => Promise.reject(new Error('spawn exploded\nstack'));
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined }).get();
    expect(got.error).toBe('gh failed: spawn exploded');
    expect(got.tickets).toEqual([]);
  });

  test('an unknown owner still lists labelled issues, with a warning', async () => {
    const { run } = stubIssues(null, [issue(1, { assignees: [{ login: 'me' }] }), labelled(2, 'Question')]);
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined }).get();
    expect(got.tickets.map(t => t.number)).toEqual([2]);
    expect(got.warning).toMatch(/only labelled issues/);
    expect(got.error).toBeNull();
  });

  test('a hand-written ticket for the same issue wins; answered or non-ticket rows do not count', async () => {
    const { run } = stubIssues('me', [1, 2, 3, 4].map(n => labelled(n, 'Question')));
    const readInbox = () => ({ questions: [
      { id: 'a', kind: 'ticket', text: '#1 by hand' },
      { id: 'b', kind: 'ticket', text: 'elsewhere', url: `${ISSUE_BASE}2` },
      { id: 'c', kind: 'ticket', text: '#3 done', answer: 'x' },
      { id: 'd', kind: 'task', text: '#4 a task, not a ticket' },
    ] });
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox, env: undefined }).get();
    expect(got.tickets.map(t => t.number)).toEqual([3, 4]);
  });

  test('an unreadable inbox deduplicates against nothing rather than failing', async () => {
    const { run } = stubIssues('me', [labelled(1, 'Question')]);
    const readInbox = (): { questions: Record<string, unknown>[] } => { throw new Error('mid-write'); };
    const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox, env: undefined }).get();
    expect(got.tickets.map(t => t.number)).toEqual([1]);
  });

  test('caches gh\'s answer for the TTL, then asks again; failures are cached too', async () => {
    const { run, calls } = stubIssues('me', [labelled(1, 'Question')]);
    const c = clock();
    const feed = createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined,
                                   now: c.now, ttlMs: 1000 });
    await feed.get();
    c.advance(999);
    await feed.get();
    const lists = () => calls.filter(a => a[0] === 'issue').length;
    expect(lists()).toBe(1);
    c.advance(1);
    await feed.get();
    expect(lists()).toBe(2);

    const failing = stubIssues('me', { ok: false, error: 'gh failed: x' });
    const f2 = createIssueFeed({ run: failing.run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox,
                                 env: undefined, now: clock().now, ttlMs: 1000 });
    await f2.get();
    await f2.get();
    expect(failing.calls).toHaveLength(1);
  });

  test('concurrent calls during a refresh share one gh run', async () => {
    const { run, calls } = stubIssues('me', [labelled(1, 'Question')]);
    const feed = createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: noInbox, env: undefined });
    const all = await Promise.all([feed.get(), feed.get(), feed.get()]);
    expect(calls.filter(a => a[0] === 'issue')).toHaveLength(1);
    for (const got of all) expect(got.tickets.map(t => t.number)).toEqual([1]);
  });

  test('a drop, an intent, or a new hand-written row shows at once, without waiting out the cache', async () => {
    const { run, calls } = stubIssues('me', [1, 2, 3].map(n => labelled(n, 'Question')));
    let cfg: DeskConfig = { repo: 'o/r' };
    let questions: Record<string, unknown>[] = [];
    const feed = createIssueFeed({ run, readConfig: () => cfg, readInbox: () => ({ questions }), env: undefined, now: clock().now });
    expect((await feed.get()).tickets.map(t => t.number)).toEqual([1, 2, 3]);
    cfg = applyTicketIntent(applyTicketIntent(cfg, `${ISSUE_BASE}1`, 'drop') as DeskConfig, `${ISSUE_BASE}2`, 'next') as DeskConfig;
    questions = [{ id: 'k', kind: 'ticket', text: '#3 by hand' }];
    const got = await feed.get();
    expect(got.tickets).toEqual([expect.objectContaining({ number: 2, intent: 'next' })]);
    expect(calls.filter(a => a[0] === 'issue')).toHaveLength(1);
  });

  test('changing the repo refetches; invalidate refetches; the environment overrides the config', async () => {
    const { run, calls } = stubIssues('me', []);
    let cfg: DeskConfig = { repo: 'o/one' };
    const feed = createIssueFeed({ run, readConfig: () => cfg, readInbox: noInbox, env: undefined, now: clock().now });
    await feed.get();
    cfg = { repo: 'o/two' };
    await feed.get();
    feed.invalidate();
    await feed.get();
    const byEnv = await createIssueFeed({ run, readConfig: () => cfg, readInbox: noInbox, env: 'env/r' }).get();
    expect(byEnv.repo).toBe('env/r');
    expect(calls.filter(a => a[0] === 'issue').map(a => a[3])).toEqual(['o/one', 'o/two', 'o/two', 'env/r']);
  });

  test('the issue cache lasts as long as the PR cache', () => {
    expect(ISSUE_TTL_MS).toBe(PR_TTL_MS);
  });
});

describe('hiddenPrs', () => {
  test('tolerates absence and junk', () => {
    expect(hiddenPrs(undefined)).toEqual(new Set());
    expect(hiddenPrs({ prHidden: 'nope' as unknown as unknown[] })).toEqual(new Set());
    expect(hiddenPrs({ prHidden: [1, '2', 2.5, null] })).toEqual(new Set([1, 2]));
  });
});
