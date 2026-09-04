/**
 * Unit tests for the pending-notice collector (#98): desk requests and unread messages
 * turned into a one-line notice, emitted only when the fingerprint changes.
 *
 * @see ../channels/pending.js
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir }                             from 'node:os';
import { join }                               from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { postMessage }                        from '../channels/messages.js';
import { writeQuestions, questionsPath }      from '../channels/desk_questions.js';
import type { DeskQuestion }                  from '../channels/desk_questions.js';
import {
  nagEpoch, fingerprint, describePending, collectPending, collectPendingWithFailures,
  lastFingerprint, rememberFingerprint, pendingNotice,
} from '../channels/pending.js';
import type { PendingItem } from '../channels/pending.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-pending-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

function withDesk<T>(fn: (deskDir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-pending-desk-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('nagEpoch', () => {

  test('counts whole nag intervals and never goes negative', () => {
    const since = '2026-08-30T00:00:00Z';
    expect(nagEpoch(since, new Date('2026-08-30T03:59:00Z'), 4)).toBe(0);
    expect(nagEpoch(since, new Date('2026-08-30T04:00:00Z'), 4)).toBe(1);
    expect(nagEpoch(since, new Date('2026-08-30T08:00:00Z'), 4)).toBe(2);
    // A "since" in the future — a clock skew or a bad row — never yields a negative epoch.
    expect(nagEpoch('2026-08-30T05:00:00Z', new Date('2026-08-30T00:00:00Z'), 4)).toBe(0);
  });

});

describe('fingerprint', () => {

  test('is order-independent and empty for no items', () => {
    const now = new Date('2026-08-30T10:00:00Z'),
          a: PendingItem = { kind: 'desk_intent', key: 'q1', label: 'x', since: '2026-08-30T06:00:00Z' },
          b: PendingItem = { kind: 'message', key: '5', label: 'y', since: '2026-08-30T09:00:00Z' };
    expect(fingerprint([a, b], now, 4)).toBe(fingerprint([b, a], now, 4));
    expect(fingerprint([], now, 4)).toBe('');
  });

});

describe('describePending', () => {

  test('pluralises and names the tool', () => {
    const msg: PendingItem   = { kind: 'message', key: '1', label: 'x', since: 'S' },
          desk1: PendingItem = { kind: 'desk_intent', key: 'q1', label: 'x', since: 'S' },
          desk2: PendingItem = { kind: 'desk_intent', key: 'q2', label: 'x', since: 'S' };
    expect(describePending([msg, desk1, desk2])).toBe(
      'pending: 2 desk requests, 1 unread message (self-expression claim_pending)');
    expect(describePending([desk1])).toBe(
      'pending: 1 desk request (self-expression claim_pending)');
  });

});

describe('the desk source', () => {

  test('reads open intents from desk.path and nothing when unset', () => withStore(s => withDesk(deskDir => {

    const now = new Date('2026-08-30T10:00:00Z');

    expect(collectPending(s, 'sess-1', now).filter(i => i.kind === 'desk_intent')).toEqual([]);

    writeConfig(s, 'desk.path', deskDir);

    const rows: DeskQuestion[] = [
      { id: 'q1', text: 'merge #21?', asked: '2026-08-30T08:00:00.000Z',
        queued: 'next', queuedAt: '2026-08-30T08:05:00.000Z' },
      { id: 'q2', text: 'already claimed', asked: '2026-08-30T08:00:00.000Z', queued: 'agents',
        claimed: { session: 'sess-1', at: '2026-08-30T08:10:00.000Z' } },
    ];
    writeQuestions(deskDir, rows);

    expect(collectPending(s, 'sess-1', now).filter(i => i.kind === 'desk_intent')).toEqual([
      { kind: 'desk_intent', key: 'q1', label: 'merge #21?', since: '2026-08-30T08:05:00.000Z' },
    ]);

  })));

});

describe('the message source', () => {

  test('surfaces unread messages for the session', () => withStore(s => {
    const now = new Date('2026-08-30T10:00:00Z');
    postMessage(s, { audience: 'self', text: 'resume at step 3', session: 'sess-1' }, VERSION, now);

    const items = collectPending(s, 'sess-1', now).filter(i => i.kind === 'message');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'message', label: 'resume at step 3' });
  }));

});

describe('pendingNotice', () => {

  test('speaks once per state, then again when an item arrives, then "clear" once', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);

      const t0 = new Date('2026-08-30T10:00:00Z'),
            t1 = new Date('2026-08-30T10:05:00Z'),
            t2 = new Date('2026-08-30T10:10:00Z'),
            t3 = new Date('2026-08-30T10:15:00Z');

      expect(pendingNotice(s, 'S', t0)).toBeNull();   // nothing pending, nothing remembered → silent

      writeQuestions(deskDir, [
        { id: 'q1', text: 'first ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
      ]);
      expect(pendingNotice(s, 'S', t1)).toMatch(/pending: 1 desk request/);
      expect(pendingNotice(s, 'S', t1)).toBeNull();   // same state, silent

      writeQuestions(deskDir, [
        { id: 'q1', text: 'first ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
        { id: 'q2', text: 'second ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
      ]);
      expect(pendingNotice(s, 'S', t2)).toMatch(/2 desk requests/);

      writeQuestions(deskDir, [
        { id: 'q1', text: 'first ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString(),
          claimed: { session: 'S', at: t3.toISOString() } },
        { id: 'q2', text: 'second ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString(),
          claimed: { session: 'S', at: t3.toISOString() } },
      ]);
      expect(pendingNotice(s, 'S', t3)).toBe('pending: clear');
      expect(pendingNotice(s, 'S', t3)).toBeNull();

    })));

  test('re-nags when an item crosses a nag boundary', () => withStore(s => withDesk(deskDir => {

    writeConfig(s, 'desk.path', deskDir);
    writeConfig(s, 'pending.nag_hours', '1');

    const t0 = new Date('2026-08-30T10:00:00Z');
    writeQuestions(deskDir, [
      { id: 'q1', text: 'ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
    ]);

    expect(pendingNotice(s, 'S', t0)).toMatch(/1 desk request/);
    expect(pendingNotice(s, 'S', new Date(t0.getTime() + 30 * 60_000))).toBeNull();          // still epoch 0
    expect(pendingNotice(s, 'S', new Date(t0.getTime() + 61 * 60_000))).toMatch(/1 desk request/); // epoch 1

  })));

  test('is silent and stores nothing when pending.enabled is false', () => withStore(s => withDesk(deskDir => {

    writeConfig(s, 'desk.path', deskDir);
    writeConfig(s, 'pending.enabled', 'false');

    const now = new Date('2026-08-30T10:00:00Z');
    writeQuestions(deskDir, [
      { id: 'q1', text: 'ask', asked: now.toISOString(), queued: 'next', queuedAt: now.toISOString() },
    ]);

    expect(pendingNotice(s, 'S', now)).toBeNull();
    expect(lastFingerprint(s, 'S')).toBeNull();

  })));

  test('a source that throws contributes nothing and does not break the others', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      writeFileSync(questionsPath(deskDir), '{ not valid json');

      const now = new Date('2026-08-30T10:00:00Z');
      postMessage(s, { audience: 'self', text: 'still here', session: 'S' }, VERSION, now);

      const items = collectPending(s, 'S', now);
      expect(items).toEqual([expect.objectContaining({ kind: 'message' })]);

      const notice = pendingNotice(s, 'S', now);
      expect(notice).toMatch(/1 unread message/);
      expect(notice).not.toMatch(/desk request/);

    })));

  test('messages.enabled=false keeps the notice silent about mail, desk requests aside', () =>
    withStore(s => withDesk(deskDir => {

      const now = new Date('2026-08-30T10:00:00Z');

      writeConfig(s, 'desk.path', deskDir);
      postMessage(s, { audience: 'self', text: 'unread but muted', session: 'S' }, VERSION, now);
      writeConfig(s, 'messages.enabled', 'false');

      // Mail is the only thing pending and the messagebox is switched off, so there is
      // nothing to say — and nothing is stored, because a fingerprint written here would
      // have to be un-written the moment the switch came back on.
      expect(pendingNotice(s, 'S', now)).toBeNull();
      expect(lastFingerprint(s, 'S')).toBeNull();

      // The other source still speaks for itself, and still says nothing about the mail.
      writeQuestions(deskDir, [
        { id: 'q1', text: 'ask', asked: now.toISOString(), queued: 'next', queuedAt: now.toISOString() },
      ]);
      const notice = pendingNotice(s, 'S', now);
      expect(notice).toMatch(/1 desk request/);
      expect(notice).not.toMatch(/unread message/);

    })));

  test('never says "clear" when the only reason the set looks empty is a failed source', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);

      const t0 = new Date('2026-08-30T10:00:00Z'),
            t1 = new Date('2026-08-30T10:05:00Z'),
            t2 = new Date('2026-08-30T10:10:00Z');

      // A real backlog, spoken and remembered.
      writeQuestions(deskDir, [
        { id: 'q1', text: 'first ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
      ]);
      expect(pendingNotice(s, 'S', t0)).toMatch(/1 desk request/);
      const remembered = lastFingerprint(s, 'S');
      expect(remembered).not.toBe('');

      // Now the desk file is unreadable and there is no mail, so the collector sees
      // nothing at all. "Nothing" here is ignorance, not an empty queue: q1 is still
      // sitting there unclaimed. Announcing 'pending: clear' — and storing '' — would be
      // the exact "the request goes quiet" failure this facility exists to end.
      writeFileSync(questionsPath(deskDir), '{ not valid json');

      expect(pendingNotice(s, 'S', t1)).toBeNull();
      expect(lastFingerprint(s, 'S')).toBe(remembered);

      // Repaired: the real set is readable again and speaks for itself.
      writeQuestions(deskDir, [
        { id: 'q1', text: 'first ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
        { id: 'q2', text: 'second ask', asked: t0.toISOString(), queued: 'next', queuedAt: t0.toISOString() },
      ]);
      expect(pendingNotice(s, 'S', t2)).toMatch(/2 desk requests/);

    })));

});

describe('collectPendingWithFailures', () => {

  test('names the sources that threw and still returns what the others found', () =>
    withStore(s => withDesk(deskDir => {

      const now = new Date('2026-08-30T10:00:00Z');

      writeConfig(s, 'desk.path', deskDir);
      writeQuestions(deskDir, [
        { id: 'q1', text: 'ask', asked: now.toISOString(), queued: 'next', queuedAt: now.toISOString() },
      ]);
      expect(collectPendingWithFailures(s, 'S', now).failed).toEqual([]);

      writeFileSync(questionsPath(deskDir), '{ not valid json');
      postMessage(s, { audience: 'self', text: 'still here', session: 'S' }, VERSION, now);

      const collected = collectPendingWithFailures(s, 'S', now);
      expect(collected.failed).toEqual(['desk_intent']);
      expect(collected.items).toEqual([expect.objectContaining({ kind: 'message' })]);

    })));

});

describe('lastFingerprint / rememberFingerprint', () => {

  test('round-trip a fingerprint for a session, independent of other sessions', () => withStore(s => {
    expect(lastFingerprint(s, 'S')).toBeNull();
    rememberFingerprint(s, 'S', 'message:1@0', new Date('2026-08-30T10:00:00Z'));
    expect(lastFingerprint(s, 'S')).toBe('message:1@0');
    expect(lastFingerprint(s, 'other')).toBeNull();
  }));

});
