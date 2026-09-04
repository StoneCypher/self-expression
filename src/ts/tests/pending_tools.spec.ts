/**
 * Unit tests for the pending-notice tool layer (#98): the `claim_pending` tool and the
 * `withPendingNotice` reply carrier.
 *
 * @see ../mcp/pending_tools.js
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { postMessage, unreadRows }            from '../channels/messages.js';
import { writeQuestions, readQuestions }      from '../channels/desk_questions.js';
import { pendingNotice }                      from '../channels/pending.js';
import { NO_HOOK_SESSION, recordContext }     from '../channels/context.js';
import {
  withPendingNotice, handleClaimPending, registerPendingTools, claimSession,
} from '../mcp/pending_tools.js';
import type { ToolReply } from '../mcp/chart_tools.js';

const VERSION = '0.2.1';

/** A body well past any plausible summary length, to prove claims carry the whole thing. */
const LONG_TEXT = 'merge #21 once the flaky windows test settles, then tag the release and tell me';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-pendtools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

function withDesk<T>(fn: (deskDir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-pendtools-desk-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Pulls the plain text out of a tool reply. */
function text(out: ToolReply): string {
  const [first] = out.content;
  return first === undefined ? '' : first.text;
}

/** Parses a `claim_pending` reply. */
function parsed(out: ToolReply): { session: string;
                                   claimed: { kind: string; key: string; label: string; since: string }[];
                                   remaining: number } {
  return JSON.parse(text(out)) as {
    session: string;
    claimed: { kind: string; key: string; label: string; since: string }[]; remaining: number };
}

/** One queued, unclaimed desk row. */
function queued(id: string, body: string, at: Date): Parameters<typeof writeQuestions>[1][number] {
  return { id, text: body, asked: at.toISOString(), queued: 'next', queuedAt: at.toISOString() };
}

describe('withPendingNotice', () => {

  test('appends the notice once, to the last text block, and leaves a quiet reply alone', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'first ask', now)]);

      const out: ToolReply = { content: [
        { type: 'text', text: 'recorded #1' },
        { type: 'text', text: 'the rendered block' },
      ] };

      const spoken = withPendingNotice(s, 'S', out, now);
      expect(spoken.content[0]?.text).toBe('recorded #1');
      expect(spoken.content[1]?.text).toBe(
        'the rendered block\n\n— pending: 1 desk request (self-expression claim_pending)');

      // The fingerprint has not moved, so the second reply carries nothing.
      const quiet = withPendingNotice(s, 'S', out, now);
      expect(quiet.content[1]?.text).toBe('the rendered block');

    })));

  test('leaves a reply with no text block alone, without swallowing the notice', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'first ask', now)]);

      expect(withPendingNotice(s, 'S', { content: [] }, now)).toEqual({ content: [] });

      // The line was never carried, so it must still be waiting to be said.
      expect(pendingNotice(s, 'S', now)).toMatch(/pending: 1 desk request/);

    })));

  test('fails open: a notice that throws leaves the reply exactly as it was', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'first ask', now)]);

      // The fingerprint store is what pendingNotice reads and writes; without it the
      // notice cannot be computed at all, which must cost the caller nothing.
      s.db.exec('DROP TABLE pending_notice');

      const out: ToolReply = { content: [{ type: 'text', text: 'recorded #1' }] };
      expect(withPendingNotice(s, 'S', out, now)).toEqual(out);

    })));

  test('does not mutate the reply it was handed', () => withStore(s => withDesk(deskDir => {
    writeConfig(s, 'desk.path', deskDir);
    const now = new Date('2026-08-30T10:00:00Z');
    writeQuestions(deskDir, [queued('q1', 'first ask', now)]);
    const out: ToolReply = { content: [{ type: 'text', text: 'recorded #1' }] };
    withPendingNotice(s, 'S', out, now);
    expect(out.content[0]?.text).toBe('recorded #1');
  })));

});

describe('handleClaimPending — desk intents', () => {

  test('stamps the row and returns its whole text, where the notice gave only a count', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', LONG_TEXT, now)]);

      const out = parsed(handleClaimPending(s, 'S', {}, now));

      expect(out.claimed).toEqual([{
        kind: 'desk_intent', key: 'q1', label: LONG_TEXT, since: now.toISOString(),
      }]);
      expect(out.remaining).toBe(0);
      // An irreversible write names the identity it ran under.
      expect(out.session).toBe('S');

      const row = readQuestions(deskDir)[0];
      expect(row?.claimed).toEqual({ session: 'S', at: now.toISOString() });
    })));

  test('an already-claimed row is not claimable a second time', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'first ask', now)]);

      expect(parsed(handleClaimPending(s, 'S', {}, now)).claimed).toHaveLength(1);
      expect(parsed(handleClaimPending(s, 'other', {}, now)).claimed).toEqual([]);
      expect(readQuestions(deskDir)[0]?.claimed).toEqual({ session: 'S', at: now.toISOString() });
    })));

  test('no desk configured means no desk claims and no error', () => withStore(s => {
    expect(parsed(handleClaimPending(s, 'S', {}, new Date('2026-08-30T10:00:00Z'))).claimed).toEqual([]);
  }));

});

describe('handleClaimPending — messages', () => {

  test('receipts the message and returns its whole body', () => withStore(s => {

    const now = new Date('2026-08-30T10:00:00Z');
    postMessage(s, { audience: 'self', text: LONG_TEXT, session: 'S' }, VERSION, now);

    const out = parsed(handleClaimPending(s, 'S', {}, now));

    expect(out.claimed).toEqual([{
      kind: 'message', key: '1', label: LONG_TEXT, since: now.toISOString(),
    }]);
    expect(out.remaining).toBe(0);
    expect(out.session).toBe('S');
    expect(unreadRows(s, 'S', now)).toEqual([]);
  }));

  test('another session\'s mail is neither claimed nor consumed', () => withStore(s => {
    const now = new Date('2026-08-30T10:00:00Z');
    postMessage(s, { audience: 'self', text: 'mine', session: 'S' }, VERSION, now);
    postMessage(s, { audience: 'self', text: 'theirs', session: 'other' }, VERSION, now);

    expect(parsed(handleClaimPending(s, 'S', {}, now)).claimed).toHaveLength(1);
    expect(unreadRows(s, 'other', now)).toHaveLength(1);
  }));

  test('a disabled messagebox is not consumed by a claim', () => withStore(s => {
    const now = new Date('2026-08-30T10:00:00Z');
    postMessage(s, { audience: 'self', text: 'still here', session: 'S' }, VERSION, now);
    writeConfig(s, 'messages.enabled', 'false');

    expect(parsed(handleClaimPending(s, 'S', {}, now)).claimed).toEqual([]);
    expect(unreadRows(s, 'S', now)).toHaveLength(1);
  }));

});

describe('handleClaimPending — narrowing', () => {

  test('kind narrows to one source; key claims exactly one item; an unknown key claims nothing', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'ask one', now), queued('q2', 'ask two', now)]);
      postMessage(s, { audience: 'self', text: 'note one', session: 'S' }, VERSION, now);
      postMessage(s, { audience: 'self', text: 'note two', session: 'S' }, VERSION, now);

      const unknown = parsed(handleClaimPending(s, 'S', { key: 'nope' }, now));
      expect(unknown.claimed).toEqual([]);
      expect(unknown.remaining).toBe(4);

      const oneDesk = parsed(handleClaimPending(s, 'S', { key: 'q2' }, now));
      expect(oneDesk.claimed.map(item => item.key)).toEqual(['q2']);
      expect(oneDesk.remaining).toBe(3);

      // The second message, not the first — a key must not consume the older mail with it.
      const oneMessage = parsed(handleClaimPending(s, 'S', { key: '2' }, now));
      expect(oneMessage.claimed.map(item => item.label)).toEqual(['note two']);
      expect(oneMessage.remaining).toBe(2);
      expect(unreadRows(s, 'S', now).map(row => row['text'])).toEqual(['note one']);

      const deskOnly = parsed(handleClaimPending(s, 'S', { kind: 'desk_intent' }, now));
      expect(deskOnly.claimed.map(item => item.key)).toEqual(['q1']);
      expect(deskOnly.remaining).toBe(1);

      const messagesOnly = parsed(handleClaimPending(s, 'S', { kind: 'message' }, now));
      expect(messagesOnly.claimed.map(item => item.label)).toEqual(['note one']);
      expect(messagesOnly.remaining).toBe(0);

    })));

  test('claims desk requests before messages, the order the notice names them in', () =>
    withStore(s => withDesk(deskDir => {
      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'ask', now)]);
      postMessage(s, { audience: 'self', text: 'note', session: 'S' }, VERSION, now);
      expect(parsed(handleClaimPending(s, 'S', {}, now)).claimed.map(item => item.kind))
        .toEqual(['desk_intent', 'message']);
    })));

});

describe('handleClaimPending and the notice together', () => {

  test('after a claim, the next pendingNotice says clear', () => withStore(s => withDesk(deskDir => {

    writeConfig(s, 'desk.path', deskDir);
    const now = new Date('2026-08-30T10:00:00Z');
    writeQuestions(deskDir, [queued('q1', 'first ask', now)]);

    expect(pendingNotice(s, 'S', now)).toMatch(/pending: 1 desk request/);
    handleClaimPending(s, 'S', {}, now);
    expect(pendingNotice(s, 'S', now)).toBe('pending: clear');
    expect(pendingNotice(s, 'S', now)).toBeNull();

  })));

});

describe('registerPendingTools', () => {

  /** The handler `registerPendingTools` installs, captured without a transport. */
  function claimHandler(s: Store): (args: Record<string, unknown>) => ToolReply {
    let found: ((args: Record<string, unknown>) => ToolReply) | undefined;
    const stub = {
      registerTool: (name: string, _config: unknown, handler: unknown): void => {
        if (name === 'claim_pending') { found = handler as (args: Record<string, unknown>) => ToolReply; }
      },
    };
    registerPendingTools(stub as unknown as Parameters<typeof registerPendingTools>[0], s);
    if (found === undefined) { throw new Error('claim_pending was not registered'); }
    return found;
  }

  test('registers claim_pending with optional kind and key', () => withStore(s => {
    const seen: { name: string; schema: Record<string, { isOptional: () => boolean }> }[] = [];
    const stub = {
      registerTool: (name: string, config: { inputSchema: Record<string, { isOptional: () => boolean }> }): void => {
        seen.push({ name, schema: config.inputSchema });
      },
    };
    registerPendingTools(stub as unknown as Parameters<typeof registerPendingTools>[0], s);

    expect(seen.map(entry => entry.name)).toEqual(['claim_pending']);
    expect(seen[0]?.schema['kind']?.isOptional()).toBe(true);
    expect(seen[0]?.schema['key']?.isOptional()).toBe(true);
    expect(seen[0]?.schema['session']?.isOptional()).toBe(true);
  }));

  test('a hook-observed session is what the claim runs under, and the reply says so', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'ask', now)]);
      recordContext(s, { session: 'observed-A', promptId: 'p-1' });

      expect(parsed(claimHandler(s)({})).session).toBe('observed-A');
      expect(readQuestions(deskDir)[0]?.claimed).toMatchObject({ session: 'observed-A' });
    })));

  test('an observed session beats a claimed one — a caller cannot claim in another name', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'ask', now)]);
      recordContext(s, { session: 'observed-A', promptId: 'p-1' });

      expect(parsed(claimHandler(s)({ session: 'B' })).session).toBe('observed-A');
      expect(readQuestions(deskDir)[0]?.claimed).toMatchObject({ session: 'observed-A' });
    })));

  test('with nothing observed, the claimed session is the fallback', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'ask', now)]);

      expect(parsed(claimHandler(s)({ session: 'B' })).session).toBe('B');
      expect(readQuestions(deskDir)[0]?.claimed).toMatchObject({ session: 'B' });
    })));

  test('with neither observed nor claimed, the visible placeholder — never an invented id', () =>
    withStore(s => withDesk(deskDir => {

      writeConfig(s, 'desk.path', deskDir);
      const now = new Date('2026-08-30T10:00:00Z');
      writeQuestions(deskDir, [queued('q1', 'ask', now)]);

      expect(parsed(claimHandler(s)({})).session).toBe(NO_HOOK_SESSION);
      expect(readQuestions(deskDir)[0]?.claimed).toMatchObject({ session: NO_HOOK_SESSION });
    })));

  test('claimSession applies the same precedence on its own', () => withStore(s => {
    expect(claimSession(s, {})).toBe(NO_HOOK_SESSION);
    expect(claimSession(s, { session: 'B' })).toBe('B');
    recordContext(s, { session: 'observed-A', promptId: 'p-1' });
    expect(claimSession(s, { session: 'B' })).toBe('observed-A');
    expect(claimSession(s, {})).toBe('observed-A');
  }));

});
