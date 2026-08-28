import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  postMessage, readMessages, unreadCounts, validateMessage, formatMessages,
  MESSAGE_TEXT_MAX,
} from '../channels/messages.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-messages-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const NOW = new Date('2026-08-28T12:00:00Z');

describe('validateMessage', () => {

  test('a well-formed self note has no problems', () => {
    expect(validateMessage({ audience: 'self', text: 'resume at step 3', session: 's1' })).toEqual([]);
  });

  test('an unknown audience names the ones that would have worked', () => {
    const problems = validateMessage({ audience: 'everyone' as never, text: 'x', session: 's1' });
    expect(problems.join('\n')).toContain("'everyone' is not a valid audience");
    expect(problems.join('\n')).toContain("'self', 'agents', 'user', 'record'");
  });

  test('agents without a box is the failure the audience table forbids', () => {
    const problems = validateMessage({ audience: 'agents', text: 'task 3 green', session: 's1' });
    expect(problems.join('\n')).toContain("audience 'agents' requires a box");
  });

  test('agents with a box passes', () => {
    expect(validateMessage({ audience: 'agents', text: 'task 3 green', session: 's1', box: 'issue-41' }))
      .toEqual([]);
  });

  test('text over the cap is rejected with the file-not-payload rationale', () => {
    const problems = validateMessage({
      audience: 'self', text: 'x'.repeat(MESSAGE_TEXT_MAX + 1), session: 's1' });
    expect(problems.join('\n')).toContain('2000');
    expect(problems.join('\n')).toContain('file');
  });

  test('text exactly at the cap passes', () => {
    expect(validateMessage({ audience: 'self', text: 'x'.repeat(MESSAGE_TEXT_MAX), session: 's1' }))
      .toEqual([]);
  });

  test('empty text, blank session, blank box, and a bad expiry are each named', () => {
    expect(validateMessage({ audience: 'self', text: '  ', session: 's1' }).join('\n'))
      .toContain('text must not be empty');
    expect(validateMessage({ audience: 'self', text: 'x', session: ' ' }).join('\n'))
      .toContain('session must not be empty');
    expect(validateMessage({ audience: 'self', text: 'x', session: 's1', box: '  ' }).join('\n'))
      .toContain('box must not be blank');
    expect(validateMessage({ audience: 'self', text: 'x', session: 's1', expiresUtc: 'someday' }).join('\n'))
      .toContain('expiresUtc must parse');
  });

  test('two problems arrive in one round trip, not two', () => {
    expect(validateMessage({ audience: 'agents', text: '', session: 's1' })).toHaveLength(2);
  });

});

describe('postMessage', () => {

  test('posts and returns identity; the row carries observed machine identity', () => withStore(s => {
    const written = postMessage(s, { audience: 'self', text: 'note', session: 's1' }, VERSION, NOW);
    expect(written.id).toBe(1);
    const row = s.db.prepare('SELECT * FROM messages WHERE id = 1').get();
    expect(row?.['uuid']).toBe(written.uuid);
    expect(row?.['machine_id']).toBe(s.machineId);
    expect(row?.['audience']).toBe('self');
    expect(row?.['plugin_version']).toBe(VERSION);
  }));

  test('throws naming every validation problem', () => withStore(s => {
    expect(() => postMessage(s, { audience: 'agents', text: '', session: 's1' }, VERSION))
      .toThrow(/cannot post message/);
  }));

  test('replyTo must reference an existing message', () => withStore(s => {
    expect(() => postMessage(s, { audience: 'self', text: 'x', session: 's1', replyTo: 99 }, VERSION))
      .toThrow(/replyTo #99 does not reference an existing message/);
    const first = postMessage(s, { audience: 'self', text: 'x', session: 's1' }, VERSION);
    const reply = postMessage(s, { audience: 'self', text: 'y', session: 's1', replyTo: first.id }, VERSION);
    expect(s.db.prepare('SELECT reply_to FROM messages WHERE id = ?').get(reply.id)?.['reply_to'])
      .toBe(first.id);
  }));

  test('expiresUtc is canonicalized to an ISO instant', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'x', session: 's1',
                     expiresUtc: '2026-08-29T00:00:00+00:00' }, VERSION, NOW);
    expect(s.db.prepare('SELECT expires_utc FROM messages').get()?.['expires_utc'])
      .toBe('2026-08-29T00:00:00.000Z');
  }));

});

describe('readMessages — delivery and receipts', () => {

  test('post/read round trip: delivered once, then never again (self)', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 's1' }, VERSION, NOW);
    const first = readMessages(s, { reader: 'model', session: 's1' }, {}, NOW);
    expect(first).toHaveLength(1);
    expect(first[0]?.['text']).toBe('note');
    expect(readMessages(s, { reader: 'model', session: 's1' }, {}, NOW)).toHaveLength(0);
  }));

  test('ack:false peeks — nothing receipted, nothing consumed', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'note', session: 's1' }, VERSION, NOW);
    expect(readMessages(s, { reader: 'model', session: 's1' }, { ack: false }, NOW)).toHaveLength(1);
    expect(s.db.prepare('SELECT COUNT(*) n FROM message_reads').get()?.['n']).toBe(0);
    expect(readMessages(s, { reader: 'model', session: 's1' }, {}, NOW)).toHaveLength(1);
  }));

  test('self is fenced by session: another session cannot collect, or even peek', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'mine', session: 's1' }, VERSION, NOW);
    expect(readMessages(s, { reader: 'model', session: 's2' }, { audience: 'self' }, NOW)).toHaveLength(0);
    expect(readMessages(s, { reader: 'model', session: 's2' }, { audience: 'self', ack: false }, NOW))
      .toHaveLength(0);
    expect(readMessages(s, { reader: 'model', session: 's1' }, { audience: 'self' }, NOW)).toHaveLength(1);
  }));

  test('agents is fenced by box, and each sibling gets its own delivery', () => withStore(s => {
    postMessage(s, { audience: 'agents', text: 'task 3 green', session: 'orch', box: 'issue-41' }, VERSION, NOW);
    postMessage(s, { audience: 'agents', text: 'other job',    session: 'orch', box: 'issue-99' }, VERSION, NOW);

    const a = readMessages(s, { reader: 'model', session: 'w1', agentId: 'agent-a' },
                           { audience: 'agents', box: 'issue-41' }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0]?.['text']).toBe('task 3 green');

    // A different agent still gets its own copy; the first agent does not.
    expect(readMessages(s, { reader: 'model', session: 'w2', agentId: 'agent-b' },
                        { audience: 'agents', box: 'issue-41' }, NOW)).toHaveLength(1);
    expect(readMessages(s, { reader: 'model', session: 'w1', agentId: 'agent-a' },
                        { audience: 'agents', box: 'issue-41' }, NOW)).toHaveLength(0);
  }));

  test('agents receipt identity falls back to session when no agentId exists', () => withStore(s => {
    postMessage(s, { audience: 'agents', text: 'x', session: 'orch', box: 'b' }, VERSION, NOW);
    expect(readMessages(s, { reader: 'model', session: 'w1' }, { audience: 'agents', box: 'b' }, NOW))
      .toHaveLength(1);
    expect(readMessages(s, { reader: 'model', session: 'w1' }, { audience: 'agents', box: 'b' }, NOW))
      .toHaveLength(0);
    expect(readMessages(s, { reader: 'model', session: 'w2' }, { audience: 'agents', box: 'b' }, NOW))
      .toHaveLength(1);
  }));

  test('a model reading user mail is never a receipt, regardless of ack', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'for the human', session: 's1' }, VERSION, NOW);
    expect(readMessages(s, { reader: 'model', session: 's1' }, { audience: 'user' }, NOW)).toHaveLength(1);
    expect(s.db.prepare('SELECT COUNT(*) n FROM message_reads').get()?.['n']).toBe(0);
    // Still unread for the human afterward.
    expect(unreadCounts(s, undefined, NOW).forUser).toBe(1);
  }));

  test("the user's own read with ack collects: a 'user' receipt, then no more unread", () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'for the human', session: 's1' }, VERSION, NOW);
    expect(readMessages(s, { reader: 'user' }, { audience: 'user' }, NOW)).toHaveLength(1);
    const receipt = s.db.prepare('SELECT reader FROM message_reads').get();
    expect(receipt?.['reader']).toBe('user');
    expect(unreadCounts(s, undefined, NOW).forUser).toBe(0);
  }));

  test('record never counts as unread and never receipts — history is what a read returns', () => withStore(s => {
    postMessage(s, { audience: 'record', text: 'for posterity', session: 's1' }, VERSION, NOW);
    expect(readMessages(s, { reader: 'model', session: 's1' }, { audience: 'record' }, NOW)).toHaveLength(1);
    expect(readMessages(s, { reader: 'model', session: 's1' }, { audience: 'record' }, NOW)).toHaveLength(1);
    expect(s.db.prepare('SELECT COUNT(*) n FROM message_reads').get()?.['n']).toBe(0);
  }));

  test('expiry excludes from delivery but never from the record', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'stale plan', session: 's1',
                     expiresUtc: '2026-08-28T00:00:00Z' }, VERSION, new Date('2026-08-27T00:00:00Z'));
    expect(readMessages(s, { reader: 'model', session: 's1' }, {}, NOW)).toHaveLength(0);
    expect(s.db.prepare('SELECT COUNT(*) n FROM messages').get()?.['n']).toBe(1);
    // A peek at history still shows it — exclusion is delivery-only.
    expect(readMessages(s, { reader: 'model', session: 's1' }, { ack: false }, NOW)).toHaveLength(1);
  }));

  test('the default read also sweeps a box when one is given', () => withStore(s => {
    postMessage(s, { audience: 'self',   text: 'note',  session: 's1' }, VERSION, NOW);
    postMessage(s, { audience: 'agents', text: 'green', session: 's1', box: 'b' }, VERSION, NOW);
    const rows = readMessages(s, { reader: 'model', session: 's1' }, { box: 'b' }, NOW);
    expect(rows.map(r => r['text'])).toEqual(['note', 'green']);
  }));

  test('limit caps each audience sweep', () => withStore(s => {
    for (let i = 0; i < 5; i += 1) {
      postMessage(s, { audience: 'self', text: `n${String(i)}`, session: 's1' }, VERSION, NOW);
    }
    expect(readMessages(s, { reader: 'model', session: 's1' }, { limit: 2 }, NOW)).toHaveLength(2);
  }));

});

describe('unreadCounts', () => {

  test('tallies self for the session and user globally; receipts and expiry both subtract', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'a', session: 's1' }, VERSION, NOW);
    postMessage(s, { audience: 'self', text: 'b', session: 's1' }, VERSION, NOW);
    postMessage(s, { audience: 'self', text: 'other session', session: 's2' }, VERSION, NOW);
    postMessage(s, { audience: 'user', text: 'mail', session: 's1' }, VERSION, NOW);
    postMessage(s, { audience: 'user', text: 'expired', session: 's1',
                     expiresUtc: '2026-08-28T00:00:00Z' }, VERSION, new Date('2026-08-27T00:00:00Z'));

    expect(unreadCounts(s, 's1', NOW)).toEqual({ forModel: 2, forUser: 1 });

    readMessages(s, { reader: 'model', session: 's1' }, {}, NOW);
    expect(unreadCounts(s, 's1', NOW)).toEqual({ forModel: 0, forUser: 1 });
  }));

  test('no session means no self count, never a cross-session guess', () => withStore(s => {
    postMessage(s, { audience: 'self', text: 'a', session: 's1' }, VERSION, NOW);
    expect(unreadCounts(s, undefined, NOW).forModel).toBe(0);
  }));

});

describe('formatMessages', () => {

  test('an empty read states itself rather than printing nothing', () => {
    expect(formatMessages([])).toBe('no messages.');
  });

  test('renders one human-first line per message, box included when present', () => {
    const text = formatMessages([
      { id: 4, ts_local: '9:14 am PDT', audience: 'user', box: null, session: 'sess-1', text: 'hello' },
      { id: 5, ts_local: '9:15 am PDT', audience: 'agents', box: 'issue-41', session: 'w1', text: 'green' },
    ]);
    expect(text).toBe(
      '#4 · 9:14 am PDT · user · from sess-1: hello\n' +
      '#5 · 9:15 am PDT · agents · box issue-41 · from w1: green');
  });

});
