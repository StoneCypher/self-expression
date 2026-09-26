/**
 * Stochastic property tests for the desk inbox's logic (`src/scripts/desk/deskinbox.mjs`).
 *
 * The unit tests pin named cases; these pin the invariants over generated inputs: the PR
 * split is a partition that respects hiding and order, a run of owner intents always lands on
 * the state a simple model predicts, the feed asks `gh` exactly as often as its cache says it
 * should, inbox posts conserve rows, permalinks are recognised exactly, and an audit row's
 * label can never be overwritten by its payload.
 *
 * `gh` is a stub throughout — a counting runner — so nothing here touches the network.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  isIssueUrl, splitPullRequests, applyPrIntent, auditRow, createPullRequestFeed, applyInboxPost,
  selectTickets, applyTicketIntent, createIssueFeed, ticketLimit,
  type DeskConfig, type PrAction, type Runner, type TicketAction,
} from '../../scripts/desk/deskinbox.mjs';

const RUNS = 200;

/** Logins drawn from a small pool so collisions with the viewer are common. */
const loginArb = fc.constantFrom('me', 'you', 'them', 'bot');

/** A list of `gh pr list` rows with distinct numbers. */
const prsArb = fc.uniqueArray(
  fc.record({
    number: fc.integer({ min: 1, max: 60 }),
    title:  fc.string({ maxLength: 20 }),
    author: fc.record({ login: loginArb }),
    isDraft: fc.boolean(),
    labels: fc.array(fc.record({ name: fc.constantFrom('Created by AI', 'bug', 'docs') }), { maxLength: 2 }),
  }),
  { selector: p => p.number, maxLength: 15 },
);

describe('splitPullRequests, stochastically', () => {
  it('is a partition of the visible PRs, in gh order, with mine exactly the viewer\'s', () => {
    fc.assert(fc.property(
      prsArb, fc.option(loginArb, { nil: null }), fc.array(fc.integer({ min: 1, max: 60 }), { maxLength: 10 }),
      (rows, viewer, hidden) => {
        const { mine, theirs } = splitPullRequests(rows, { viewer, cfg: { prHidden: hidden } });
        const visible = rows.filter(r => !hidden.includes(r.number));
        const hide = new Set(hidden);

        expect(mine.length + theirs.length).toBe(visible.length);
        for (const p of [...mine, ...theirs]) expect(hide.has(p.number)).toBe(false);

        const byNumber = new Map(rows.map(r => [r.number, r]));
        for (const p of mine)   expect(byNumber.get(p.number)?.author.login).toBe(viewer);
        for (const p of theirs) expect(viewer !== null && byNumber.get(p.number)?.author.login === viewer).toBe(false);

        const order = (list: { number: number }[]) => list.map(p => visible.findIndex(r => r.number === p.number));
        for (const idx of [order(mine), order(theirs)]) {
          expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        }
        for (const p of [...mine, ...theirs]) {
          expect(p.ai).toBe((byNumber.get(p.number)?.labels ?? []).some(l => l.name === 'Created by AI'));
        }
      }), { numRuns: RUNS });
  });
});

describe('applyPrIntent, stochastically', () => {
  it('a run of intents lands on the state the model predicts', () => {
    const stepArb = fc.record({ n: fc.integer({ min: 1, max: 8 }),
                                action: fc.constantFrom<PrAction>('land', 'agent', 'drop') });
    fc.assert(fc.property(fc.array(stepArb, { maxLength: 30 }), steps => {
      let cfg: DeskConfig = { name: 'kept' };
      const hidden = new Set<number>(), intent = new Map<number, PrAction>();
      for (const { n, action } of steps) {
        const next = applyPrIntent(cfg, n, action);
        expect(next).not.toBeNull();
        cfg = next as DeskConfig;
        if (action === 'drop') { hidden.add(n); intent.delete(n); } else { intent.set(n, action); }
      }
      expect(cfg['name']).toBe('kept');
      expect(new Set(cfg.prHidden ?? [])).toEqual(hidden);
      expect((cfg.prHidden ?? []).length).toBe(hidden.size);           // hidden once, never twice
      expect(Object.keys(cfg.prIntent ?? {}).map(Number).sort((a, b) => a - b))
        .toEqual([...intent.keys()].sort((a, b) => a - b));
      for (const [n, a] of intent) expect(cfg.prIntent?.[n]).toBe(a);
    }), { numRuns: RUNS });
  });

  it('refuses every action that is not one of the three verbs', () => {
    fc.assert(fc.property(fc.string(), fc.integer({ min: 1 }), (action, n) => {
      fc.pre(!['land', 'agent', 'drop'].includes(action));
      expect(applyPrIntent({}, n, action)).toBeNull();
    }), { numRuns: RUNS });
  });
});

describe('createPullRequestFeed, stochastically', () => {
  it('runs gh pr list exactly when the cache model says it must', async () => {
    const opArb = fc.oneof(
      fc.record({ op: fc.constant('get' as const) }),
      /* Weighted toward the TTL's edges, where an off-by-one lives; a uniform draw almost
         never lands a total of exactly 1000. */
      fc.record({ op: fc.constant('wait' as const),
                  ms: fc.oneof(fc.constantFrom(0, 1, 499, 500, 999, 1000, 1001), fc.integer({ min: 0, max: 1500 })) }),
      fc.record({ op: fc.constant('invalidate' as const) }),
    );
    await fc.assert(fc.asyncProperty(fc.array(opArb, { maxLength: 25 }), async ops => {
      let t = 0, lists = 0;
      const run: Runner = args => {
        if (args[0] === 'pr') lists += 1;
        return Promise.resolve({ ok: true, stdout: args[0] === 'api' ? 'me' : '[]' });
      };
      const feed = createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined,
                                          now: () => t, ttlMs: 1000 });
      let cachedAt: number | null = null, expected = 0;
      for (const step of ops) {
        if (step.op === 'wait') t += step.ms;
        else if (step.op === 'invalidate') { feed.invalidate(); cachedAt = null; }
        else {
          if (cachedAt === null || t - cachedAt >= 1000) { expected += 1; cachedAt = t; }
          await feed.get();
        }
      }
      expect(lists).toBe(expected);
    }), { numRuns: RUNS,
          examples: [[[{ op: 'get' }, { op: 'wait', ms: 1000 }, { op: 'get' }]]] });
  });

  it('never rejects and never goes blank without saying why, whatever gh does', async () => {
    const answerArb = fc.oneof(
      fc.record({ ok: fc.constant(true as const), stdout: fc.string({ maxLength: 30 }) }),
      fc.record({ ok: fc.constant(false as const), error: fc.string({ minLength: 1, maxLength: 30 }) }),
    );
    await fc.assert(fc.asyncProperty(answerArb, answerArb, async (listAnswer, userAnswer) => {
      const run: Runner = args => Promise.resolve(args[0] === 'api' ? userAnswer : listAnswer);
      const got = await createPullRequestFeed({ run, readConfig: () => ({ repo: 'o/r' }), env: undefined }).get();
      let rows: unknown = null;
      if (listAnswer.ok) { try { rows = JSON.parse(listAnswer.stdout); } catch { rows = null; } }
      if (!Array.isArray(rows)) {
        expect(typeof got.error).toBe('string');
        expect(got.error).not.toBe('');
        expect(got.mine).toEqual([]);
        expect(got.theirs).toEqual([]);
      } else {
        expect(got.error).toBeNull();
      }
    }), { numRuns: RUNS });
  });
});

describe('selectTickets, stochastically', () => {
  const urlOf = (n: number) => `https://github.com/o/r/issues/${String(n)}`;
  const labelArb = fc.constantFrom('Question', 'question', 'Needs answers', 'needs owner', 'NEEDS RESEARCH', 'bug', 'docs');
  const QUALIFYING = new Set(['question', 'needs answers', 'needs owner', 'needs research']);

  /** Open issues with distinct numbers, assigned and labelled from small pools so every branch is common. */
  const issuesArb = fc.uniqueArray(
    fc.record({
      number:    fc.integer({ min: 1, max: 40 }),
      title:     fc.string({ maxLength: 12 }),
      labels:    fc.array(fc.record({ name: labelArb }), { maxLength: 3 }),
      assignees: fc.array(fc.record({ login: loginArb }), { maxLength: 2 }),
    }).map(r => ({ ...r, url: urlOf(r.number) })),
    { selector: r => r.number, maxLength: 20 },
  );
  const numbersArb = fc.array(fc.integer({ min: 1, max: 40 }), { maxLength: 8 });

  it('shows exactly the first qualifying, undropped, not-hand-written issues in gh order, and benches the rest', () => {
    fc.assert(fc.property(
      issuesArb, fc.option(loginArb, { nil: null }), numbersArb, numbersArb, fc.integer({ min: 0, max: 12 }),
      (rows, viewer, dropped, byHand, limit) => {
        const cfg: DeskConfig = { ticketLimit: limit, ticketHidden: dropped.map(urlOf) };
        const handWritten = new Set(byHand.map(urlOf));
        const { tickets, bench } = selectTickets(rows, { viewer, cfg, repo: 'o/r', handWritten });

        /* The model: filter in gh order, then cut at the limit. */
        const eligible = rows.filter(r =>
          !dropped.includes(r.number) && !byHand.includes(r.number) &&
          ((viewer !== null && r.assignees.some(a => a.login === viewer)) ||
           r.labels.some(l => QUALIFYING.has(l.name.toLowerCase()))));

        expect(tickets.map(t => t.number)).toEqual(eligible.slice(0, limit).map(r => r.number));
        expect(bench).toBe(Math.max(0, eligible.length - limit));
        expect(tickets.length).toBeLessThanOrEqual(ticketLimit(cfg));
        for (const t of tickets) {
          expect(t.url).toBe(urlOf(t.number));
          for (const l of t.labels) expect(QUALIFYING.has(l.toLowerCase())).toBe(true);
          expect(t.assigned || t.labels.length > 0).toBe(true);
        }
      }), { numRuns: RUNS });
  });

  it('dropping any shown ticket promotes the first benched one and moves nothing else', () => {
    fc.assert(fc.property(issuesArb, fc.integer({ min: 1, max: 6 }), fc.nat(), (rows, limit, pick) => {
      const opts = (cfg: DeskConfig) => ({ viewer: 'me', cfg, repo: 'o/r', handWritten: new Set<string>() });
      const before = selectTickets(rows, opts({ ticketLimit: limit }));
      fc.pre(before.tickets.length > 0);
      const gone = before.tickets[pick % before.tickets.length];
      if (gone === undefined) return;
      const cfg = applyTicketIntent({ ticketLimit: limit }, gone.url, 'drop') as DeskConfig;
      const after = selectTickets(rows, opts(cfg));

      const kept = before.tickets.filter(t => t.url !== gone.url).map(t => t.number);
      expect(after.tickets.map(t => t.number).slice(0, kept.length)).toEqual(kept);
      expect(after.tickets.length).toBe(before.tickets.length - (before.bench > 0 ? 0 : 1));
      expect(after.bench).toBe(Math.max(0, before.bench - 1));
    }), { numRuns: RUNS });
  });
});

describe('applyTicketIntent, stochastically', () => {
  it('a run of intents lands on the state the model predicts', () => {
    const stepArb = fc.record({ n: fc.integer({ min: 1, max: 8 }),
                                action: fc.constantFrom<TicketAction>('next', 'agents', 'drop') });
    fc.assert(fc.property(fc.array(stepArb, { maxLength: 30 }), steps => {
      let cfg: DeskConfig = { name: 'kept', prIntent: { 1: 'land' } };
      const hidden = new Set<string>(), intent = new Map<string, TicketAction>();
      for (const { n, action } of steps) {
        const url = `https://github.com/o/r/issues/${String(n)}`;
        const next = applyTicketIntent(cfg, url, action);
        expect(next).not.toBeNull();
        cfg = next as DeskConfig;
        if (action === 'drop') { hidden.add(url); intent.delete(url); } else { intent.set(url, action); }
      }
      expect(cfg['name']).toBe('kept');
      expect(cfg.prIntent).toEqual({ 1: 'land' });                       // PR state is not touched
      expect(new Set(cfg.ticketHidden ?? [])).toEqual(hidden);
      expect((cfg.ticketHidden ?? []).length).toBe(hidden.size);         // hidden once, never twice
      expect(new Map(Object.entries(cfg.ticketIntent ?? {}))).toEqual(intent);
    }), { numRuns: RUNS });
  });

  it('refuses every action outside the three verbs and every url that is not an issue permalink', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (action, url) => {
      const goodUrl = 'https://github.com/o/r/issues/1';
      if (!['next', 'agents', 'drop'].includes(action)) expect(applyTicketIntent({}, goodUrl, action)).toBeNull();
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d{1,7}$/.test(url)) {
        expect(applyTicketIntent({}, url, 'next')).toBeNull();
      }
    }), { numRuns: RUNS });
  });
});

describe('createIssueFeed, stochastically', () => {
  it('runs gh issue list exactly when the cache model says it must', async () => {
    const opArb = fc.oneof(
      fc.record({ op: fc.constant('get' as const) }),
      fc.record({ op: fc.constant('wait' as const),
                  ms: fc.oneof(fc.constantFrom(0, 1, 499, 500, 999, 1000, 1001), fc.integer({ min: 0, max: 1500 })) }),
      fc.record({ op: fc.constant('invalidate' as const) }),
    );
    await fc.assert(fc.asyncProperty(fc.array(opArb, { maxLength: 25 }), async ops => {
      let t = 0, lists = 0;
      const run: Runner = args => {
        if (args[0] === 'issue') lists += 1;
        return Promise.resolve({ ok: true, stdout: args[0] === 'api' ? 'me' : '[]' });
      };
      const feed = createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }), readInbox: () => ({ questions: [] }),
                                     env: undefined, now: () => t, ttlMs: 1000 });
      let cachedAt: number | null = null, expected = 0;
      for (const step of ops) {
        if (step.op === 'wait') t += step.ms;
        else if (step.op === 'invalidate') { feed.invalidate(); cachedAt = null; }
        else {
          if (cachedAt === null || t - cachedAt >= 1000) { expected += 1; cachedAt = t; }
          await feed.get();
        }
      }
      expect(lists).toBe(expected);
    }), { numRuns: RUNS,
          examples: [[[{ op: 'get' }, { op: 'wait', ms: 1000 }, { op: 'get' }]]] });
  });

  it('never rejects and never goes blank without saying why, whatever gh does', async () => {
    const answerArb = fc.oneof(
      fc.record({ ok: fc.constant(true as const), stdout: fc.string({ maxLength: 30 }) }),
      fc.record({ ok: fc.constant(false as const), error: fc.string({ minLength: 1, maxLength: 30 }) }),
    );
    await fc.assert(fc.asyncProperty(answerArb, answerArb, async (listAnswer, userAnswer) => {
      const run: Runner = args => Promise.resolve(args[0] === 'api' ? userAnswer : listAnswer);
      const got = await createIssueFeed({ run, readConfig: () => ({ repo: 'o/r' }),
                                          readInbox: () => ({ questions: [] }), env: undefined }).get();
      let rows: unknown = null;
      if (listAnswer.ok) { try { rows = JSON.parse(listAnswer.stdout); } catch { rows = null; } }
      if (!Array.isArray(rows)) {
        expect(typeof got.error).toBe('string');
        expect(got.error).not.toBe('');
        expect(got.tickets).toEqual([]);
      } else {
        expect(got.error).toBeNull();
      }
    }), { numRuns: RUNS });
  });
});

describe('applyInboxPost, stochastically', () => {
  const rowArb = (prefix: string) => fc.record({
    id:     fc.integer({ min: 0, max: 9 }).map(i => `${prefix}${String(i)}`),
    kind:   fc.constantFrom('task', 'ticket', undefined),
    text:   fc.string({ maxLength: 10 }),
    answer: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: undefined }),
  }).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));

  const docArb = fc.record({
    questions: fc.uniqueArray(rowArb('q'), { selector: r => r['id'], maxLength: 8 }),
    reserve:   fc.uniqueArray(rowArb('r'), { selector: r => r['id'], maxLength: 4 }),
  });

  const postArb = fc.record({
    id:      fc.integer({ min: 0, max: 11 }).map(i => `q${String(i)}`),
    action:  fc.constantFrom('drop', 'next', 'agents', 'bogus', undefined),
    dismiss: fc.boolean(),
    answer:  fc.option(fc.string({ maxLength: 5 }), { nil: undefined }),
  });

  it('conserves rows, keeps answers one-way, and moves bench rows only on a ticket drop', () => {
    fc.assert(fc.property(docArb, postArb, (start, post) => {
      const before = structuredClone(start);
      const { doc, event } = applyInboxPost(start, post, 'AT');
      expect(start).toEqual(before);                                   // pure

      const target = before.questions.find(q => q['id'] === post.id);
      if (!target) { expect(event).toBeNull(); expect(doc).toBe(start); return; }

      const total = (d: typeof doc) => d.questions.length + d.reserve.length;
      if (post.action === 'drop') {
        expect(total(doc)).toBe(total(before) - 1);
        expect(doc.questions.some(q => q['id'] === post.id)).toBe(false);
        const promoted = target['kind'] === 'ticket' && before.reserve.length > 0;
        expect(doc.reserve.length).toBe(before.reserve.length - (promoted ? 1 : 0));
      } else {
        expect(total(doc)).toBe(total(before));
        expect(doc.reserve).toEqual(before.reserve);
        const after = doc.questions.find(q => q['id'] === post.id);
        if (target['answer'] !== undefined && post.action !== 'next' && post.action !== 'agents') {
          expect(after).toEqual(target);                               // an answer is final
        }
      }
    }), { numRuns: RUNS });
  });
});

describe('permalinks and audit rows, stochastically', () => {
  const nameArb = (max: number) => fc.stringMatching(new RegExp(`^[A-Za-z0-9_.-]{1,${String(max)}}$`));

  it('recognises every generated permalink, and nothing with a character appended', () => {
    fc.assert(fc.property(
      nameArb(39), nameArb(100), fc.constantFrom('issues', 'pull'), fc.integer({ min: 0, max: 9_999_999 }),
      fc.constantFrom('#', '/', '?', ' ', 'x', '\n'),
      (owner, repo, kind, n, extra) => {
        const url = `https://github.com/${owner}/${repo}/${kind}/${String(n)}`;
        expect(isIssueUrl(url)).toBe(true);
        expect(isIssueUrl(url + extra)).toBe(false);
      }), { numRuns: RUNS });
  });

  it('an audit row always carries its own action and time, whatever the detail holds', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 })), fc.string(), fc.string(),
      (detail, action, at) => {
        const row = auditRow(action, detail, at);
        expect(row['action']).toBe(action);
        expect(row['at']).toBe(at);
      }), { numRuns: RUNS });
  });
});
