import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { recordContext }                      from '../channels/context.js';
import {
  handlePostMessage, handleReadMessages, messagesDisabled, MESSAGES_DISABLED_REPLY,
} from '../mcp/message_tools.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-msgtools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** The single text content a tool reply carries. */
function text(reply: { content: readonly { text: string }[] }): string {
  return reply.content[0]?.text ?? '';
}

describe('handlePostMessage', () => {

  test('adopts hook-observed identity, exactly as express does', () => withStore(s => {
    recordContext(s, { session: 'sess-1', promptId: 'p1', agentId: 'a1', agentType: 'worker' });
    const reply = handlePostMessage(s, VERSION, { audience: 'self', text: 'note' });
    expect(text(reply)).toMatch(/^posted #1 /);
    const row = s.db.prepare('SELECT * FROM messages WHERE id = 1').get();
    expect(row?.['session']).toBe('sess-1');
    expect(row?.['prompt_id']).toBe('p1');
    expect(row?.['agent_id']).toBe('a1');
    expect(row?.['agent_type']).toBe('worker');
  }));

  test("no hook context is recorded as 'no-hook', never disguised as a plausible session", () => withStore(s => {
    handlePostMessage(s, VERSION, { audience: 'record', text: 'x' });
    expect(s.db.prepare('SELECT session FROM messages').get()?.['session']).toBe('no-hook');
  }));

  test('a caller-supplied session wins over the observation, as in express', () => withStore(s => {
    recordContext(s, { session: 'sess-1' });
    handlePostMessage(s, VERSION, { audience: 'self', text: 'x', session: 'sess-2' });
    expect(s.db.prepare('SELECT session FROM messages').get()?.['session']).toBe('sess-2');
  }));

  test('a validation failure throws naming the rule — the box requirement included', () => withStore(s => {
    expect(() => handlePostMessage(s, VERSION, { audience: 'agents', text: 'x' }))
      .toThrow(/requires a box/);
  }));

  test('the kill switch replies rather than posting', () => withStore(s => {
    writeConfig(s, 'messages.enabled', false);
    expect(messagesDisabled(s)).toBe(true);
    const reply = handlePostMessage(s, VERSION, { audience: 'self', text: 'x' });
    expect(text(reply)).toBe(MESSAGES_DISABLED_REPLY);
    expect(s.db.prepare('SELECT COUNT(*) n FROM messages').get()?.['n']).toBe(0);
  }));

  test('an invalid stored kill switch behaves as enabled (tolerant reader)', () => withStore(s => {
    writeConfig(s, 'messages.enabled', 'off');
    expect(messagesDisabled(s)).toBe(false);
  }));

});

describe('handleReadMessages', () => {

  test('replies with the resolved reader identity and the messages', () => withStore(s => {
    recordContext(s, { session: 'sess-1', promptId: 'p1' });
    handlePostMessage(s, VERSION, { audience: 'self', text: 'note' });
    const parsed = JSON.parse(text(handleReadMessages(s, {}))) as
      { reader: Record<string, unknown>; messages: Record<string, unknown>[] };
    expect(parsed.reader['reader']).toBe('model');
    expect(parsed.reader['session']).toBe('sess-1');
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]?.['text']).toBe('note');
  }));

  test('the hook-observed session beats a claimed one for collection', () => withStore(s => {
    recordContext(s, { session: 'sess-1' });
    handlePostMessage(s, VERSION, { audience: 'self', text: 'mine', session: 'sess-2' });
    // The claimed sess-2 must not let this reader collect sess-2's notes.
    const parsed = JSON.parse(text(handleReadMessages(s, { audience: 'self', session: 'sess-2' }))) as
      { reader: Record<string, unknown>; messages: unknown[] };
    expect(parsed.reader['session']).toBe('sess-1');
    expect(parsed.messages).toHaveLength(0);
  }));

  test('the session argument fills in only when no hook has run', () => withStore(s => {
    handlePostMessage(s, VERSION, { audience: 'self', text: 'x', session: 'sess-9' });
    const parsed = JSON.parse(text(handleReadMessages(s, { session: 'sess-9' }))) as
      { reader: Record<string, unknown>; messages: unknown[] };
    expect(parsed.reader['session']).toBe('sess-9');
    expect(parsed.messages).toHaveLength(1);
  }));

  test('reading agents without a box is refused, naming the rule', () => withStore(s => {
    const reply = text(handleReadMessages(s, { audience: 'agents' }));
    expect(reply).toContain('error');
    expect(reply).toContain('requires a box');
  }));

  test('the kill switch replies rather than reading', () => withStore(s => {
    writeConfig(s, 'messages.enabled', false);
    expect(text(handleReadMessages(s, {}))).toBe(MESSAGES_DISABLED_REPLY);
  }));

  test('a full round trip through both handlers delivers exactly once', () => withStore(s => {
    recordContext(s, { session: 'sess-1' });
    handlePostMessage(s, VERSION, { audience: 'self', text: 'once' });
    const first  = JSON.parse(text(handleReadMessages(s, {}))) as { messages: unknown[] },
          second = JSON.parse(text(handleReadMessages(s, {}))) as { messages: unknown[] };
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(0);
  }));

});
