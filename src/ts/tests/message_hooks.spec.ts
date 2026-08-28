import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { postMessage, unreadCounts } from '../channels/messages.js';
import {
  mailboxLine, onSessionStart, onUserPromptSubmit, handleHook,
} from '../mcp/hooks.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-msghooks-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const NOW = new Date('2026-08-28T12:00:00Z');

function additionalContext(out: unknown): string {
  return String((out as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext);
}

describe('mailboxLine', () => {

  test('null when nothing is unread — the common no-mail turn costs nothing', () => withStore(s => {
    expect(mailboxLine(s, 'sess-1', NOW)).toBeNull();
  }));

  test('both counts render in the spec shape', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'a', session: 'sess-1' }, VERSION, NOW);
    postMessage(s, { audience: 'self', text: 'b', session: 'sess-1' }, VERSION, NOW);
    postMessage(s, { audience: 'user', text: 'c', session: 'sess-1' }, VERSION, NOW);
    expect(mailboxLine(s, 'sess-1', NOW)).toBe(
      'Mailbox: 2 unread for you, 1 for your human partner (self-expression read_messages).');
  }));

  test('a single nonzero side renders alone', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'c', session: 'sess-1' }, VERSION, NOW);
    expect(mailboxLine(s, 'sess-1', NOW)).toBe(
      'Mailbox: 1 for your human partner (self-expression read_messages).');
  }));

  test("another session's self notes do not count for this one", () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'a', session: 'sess-2' }, VERSION, NOW);
    expect(mailboxLine(s, 'sess-1', NOW)).toBeNull();
  }));

  test('messages.notify false silences the line; the facility stays on', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'c', session: 'sess-1' }, VERSION, NOW);
    writeConfig(s, 'messages.notify', false);
    expect(mailboxLine(s, 'sess-1', NOW)).toBeNull();
    expect(unreadCounts(s, 'sess-1', NOW).forUser).toBe(1);
  }));

  test('messages.enabled false silences the line too — the kill switch covers every moment', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'c', session: 'sess-1' }, VERSION, NOW);
    writeConfig(s, 'messages.enabled', false);
    expect(mailboxLine(s, 'sess-1', NOW)).toBeNull();
  }));

});

describe('onUserPromptSubmit — mailbox segment', () => {

  test('carries the count line between the flags and the reminder when mail waits', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'c', session: 'sess-1' }, VERSION, NOW);
    const context = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-1' }, NOW));
    expect(context).toContain('Mailbox: 1 for your human partner');
    expect(context.indexOf('conventions:')).toBeLessThan(context.indexOf('Mailbox:'));
    expect(context.indexOf('Mailbox:')).toBeLessThan(context.indexOf('Open this turn'));
  }));

  test('carries no mailbox segment when nothing is unread', () => withStore(s => {
    const context = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-1' }, NOW));
    expect(context).not.toContain('Mailbox:');
  }));

  test('the count fences self mail by the payload session', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'x', session: 'sess-1' }, VERSION, NOW);
    const own   = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-1' }, NOW)),
          other = additionalContext(onUserPromptSubmit(s, { session_id: 'sess-2' }, NOW));
    expect(own).toContain('Mailbox: 1 unread for you');
    expect(other).not.toContain('Mailbox:');
  }));

});

describe('onSessionStart', () => {

  test('injects the full text of unread self notes on compact, receipting them', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'resume at step 3', session: 'sess-1' }, VERSION, NOW);
    postMessage(s, { audience: 'self', text: 'the branch is feat_x', session: 'sess-1' }, VERSION, NOW);

    const out = onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW);
    const context = additionalContext(out);
    expect(context).toContain('resume at step 3');
    expect(context).toContain('the branch is feat_x');
    expect(JSON.stringify(out)).toContain('SessionStart');

    // Delivered means receipted: a second start injects nothing.
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW)).toBeNull();
  }));

  test('fires on resume as well', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 'sess-1' }, VERSION, NOW);
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'resume' }, NOW)).not.toBeNull();
  }));

  test('stays silent on startup — a fresh session has no past self', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 'sess-1' }, VERSION, NOW);
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'startup' }, NOW)).toBeNull();
    // And nothing was consumed by the silence.
    expect(unreadCounts(s, 'sess-1', NOW).forModel).toBe(1);
  }));

  test("only the session's own notes are injected", () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'other', session: 'sess-2' }, VERSION, NOW);
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW)).toBeNull();
  }));

  test('expired notes are not injected', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'stale', session: 'sess-1',
                     expiresUtc: '2026-08-28T00:00:00Z' }, VERSION, new Date('2026-08-27T00:00:00Z'));
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW)).toBeNull();
  }));

  test('governed by messages.enabled alone — notify does not silence it', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 'sess-1' }, VERSION, NOW);
    writeConfig(s, 'messages.notify', false);
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW)).not.toBeNull();
  }));

  test('messages.enabled false silences it', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 'sess-1' }, VERSION, NOW);
    writeConfig(s, 'messages.enabled', false);
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW)).toBeNull();
  }));

  test('fails open with no store, and with no session', () => withStore(s => {
    expect(onSessionStart(null, { session_id: 'x', source: 'compact' }, NOW)).toBeNull();
    expect(onSessionStart(s, { source: 'compact' }, NOW)).toBeNull();
  }));

  test('fails open on a broken store rather than wedging the session start', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 'sess-1' }, VERSION, NOW);
    s.db.exec('DROP TABLE message_reads');
    expect(onSessionStart(s, { session_id: 'sess-1', source: 'compact' }, NOW)).toBeNull();
  }));

  test('dispatches through handleHook by name', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 'sess-1' }, VERSION, NOW);
    const out = handleHook('session-start', s, { session_id: 'sess-1', source: 'compact' }, NOW);
    expect(JSON.stringify(out)).toContain('SessionStart');
  }));

});
