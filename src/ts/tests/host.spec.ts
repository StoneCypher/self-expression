/**
 * Unit tests for host-scoped session resolution (issue #130). Several Claude Code
 * sessions share one store, and an unscoped `express` must be stamped with its own
 * session's turn, not the newest turn of any session.
 *
 * Every scenario runs the real hook handler and the real `express` handler against a
 * real store, each through the host identity its production entry point attaches.
 * Nothing here builds the expected row by hand.
 *
 * @see ../channels/host.js
 * @see ../channels/context.js latestContext
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, test, expect } from 'vitest';

import { openStore, closeStore, readMeta } from '../channels/store.js';
import type { Store }                      from '../channels/store.js';
import {
  validPid, hookHostPid, hookHostIdentity, serverHostIdentity, withHost, UNKNOWN_HOST,
} from '../channels/host.js';
import {
  latestContext, latestHookContext, recordContext, stoppedTurnPrompt,
} from '../channels/context.js';
import { hasClosingSignature } from '../channels/entries.js';
import { hasColumn, migrate }  from '../channels/migrate.js';
import { SCHEMA_VERSION }      from '../channels/schema.js';
import { onUserPromptSubmit, onStop, stopTurn } from '../mcp/hooks.js';
import { handleExpress, handleBeginTurn }        from '../mcp/tools.js';
import { buildV8 } from './helpers/v8_fixture.js';

const VERSION = '0.9.0';

/** When each simulated server started; every hook turn below happens after it. */
const START = new Date('2026-09-26T15:00:00Z');

/** A moment `minutes` after {@link START}. */
function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-host-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** The store as a hook process under host `pid` sees it: `CLAUDE_PID` set, parent a shell. */
function hookView(s: Store, pid: number): Store {
  return withHost(s, hookHostIdentity({ CLAUDE_PID: String(pid) }, 7));
}

/** The store as the MCP server under host `pid` sees it: its parent is the host. */
function serverView(s: Store, pid: number, env: Record<string, string> = {}): Store {
  return withHost(s, serverHostIdentity(env, pid, START));
}

/** Fire the real turn-start hook for one turn of one host. */
function promptSubmit(s: Store, pid: number, session: string, prompt: string, minutes: number): void {
  onUserPromptSubmit(hookView(s, pid), { session_id: session, prompt_id: prompt }, at(minutes));
}

/** The newest entry's (session, prompt_id). */
function lastStamp(s: Store): [unknown, unknown] {
  const row = s.db.prepare('SELECT session, prompt_id FROM entries ORDER BY id DESC LIMIT 1').get();
  return [row?.['session'], row?.['prompt_id']];
}

describe('validPid, and how each side learns its host', () => {

  test('accepts real pids and rejects init, idle, and garbage', () => {
    expect(validPid('39700')).toBe(39700);
    expect(validPid(54736)).toBe(54736);
    for (const bad of [undefined, '', 'abc', '12.5', '-4', 0, 1, '1', Number.NaN]) {
      expect(validPid(bad)).toBeNull();
    }
  });

  test('a hook prefers CLAUDE_PID and falls back to its parent pid', () => {
    expect(hookHostPid({ CLAUDE_PID: '54736' }, 36732)).toBe(54736);
    expect(hookHostPid({}, 36732)).toBe(36732);
    expect(hookHostPid({ CLAUDE_PID: 'junk' }, 36732)).toBe(36732);
    expect(hookHostPid({}, 1)).toBeNull();
    expect(hookHostIdentity({ CLAUDE_PID: '54736' }, 36732))
      .toEqual({ pid: 54736, since: null, session: null });
  });

  test('a server uses its parent pid and ignores an inherited CLAUDE_PID', () => {
    const id = serverHostIdentity({ CLAUDE_PID: '39700', CLAUDE_CODE_SESSION_ID: 'sess-x' }, 54736, START);
    expect(id).toEqual({ pid: 54736, since: START.toISOString(), session: 'sess-x' });
    expect(serverHostIdentity({ CLAUDE_CODE_SESSION_ID: '' }, 54736, START).session).toBeNull();
  });

  test('withHost shares the handle and leaves the original store unscoped', () => withStore(s => {
    const scoped = withHost(s, UNKNOWN_HOST);
    expect(scoped.db).toBe(s.db);
    expect(scoped.host).toBe(UNKNOWN_HOST);
    expect(s.host).toBeUndefined();
  }));

});

describe('two hosts, interleaved turns', () => {

  test('the hook stamps each row with its own host pid', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    const pids = s.db.prepare('SELECT session, host_pid FROM turn_context ORDER BY id').all()
      .map(r => [r['session'], r['host_pid']]);
    expect(pids).toEqual([['sess-A', 1001], ['sess-B', 2002]]);
  }));

  test("an unscoped express from host A is stamped with A's turn, not B's newer one", () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);

    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'still; unchanged', position: 'close' });
    expect(lastStamp(s)).toEqual(['sess-A', 'a1']);

    handleExpress(serverView(s, 2002), VERSION, { channel: 'signature', text: 'flow', position: 'close' });
    expect(lastStamp(s)).toEqual(['sess-B', 'b1']);
  }));

  test("the Stop gate passes A's signed turn although B's turn started in between", () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'still; unchanged', position: 'close' });

    expect(onStop(hookView(s, 1001), { session_id: 'sess-A', prompt_id: 'a1' })).toBeNull();
    // …and B, which never signed, is still refused: the gate did not go soft.
    expect(onStop(hookView(s, 2002), { session_id: 'sess-B', prompt_id: 'b1' })?.['decision']).toBe('block');
  }));

  test('before the fix this interleaving misfiled: the global newest is B', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    // The unscoped, hostless reading is the pre-#130 behaviour this suite guards against.
    expect(latestContext(s)?.['session']).toBe('sess-B');
    expect(latestContext(serverView(s, 1001))?.['session']).toBe('sess-A');
  }));

  test('turn_signed-style reads and begin_turn rows follow the host too', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    handleBeginTurn(serverView(s, 1001), { session: 'sess-A', promptId: 'a1' });   // already recorded: adopts
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    expect(latestHookContext(serverView(s, 1001))?.['prompt_id']).toBe('a1');
    expect(latestHookContext(serverView(s, 2002))?.['prompt_id']).toBe('b1');
  }));

  test('a begin_turn row written through the server carries the server host pid', () => withStore(s => {
    handleBeginTurn(serverView(s, 3003), { session: 'sess-C', promptId: 'c1' });
    expect(s.db.prepare('SELECT host_pid FROM turn_context').get()?.['host_pid']).toBe(3003);
  }));

  test('a subagent shares its parent host, so it resolves to the parent session', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    // The subagent's server is the parent's server; agent identity rides separately.
    handleExpress(serverView(s, 1001), VERSION, { channel: 'idea', text: 'from a subagent' });
    expect(lastStamp(s)).toEqual(['sess-A', 'a1']);
  }));

});

describe('the fallbacks — never worse than before', () => {

  test('no host identity: the newest row of any session, exactly as before', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    handleExpress(s, VERSION, { channel: 'signature', text: 'x', position: 'close' });
    expect(lastStamp(s)).toEqual(['sess-B', 'b1']);
    expect(latestContext(withHost(s, UNKNOWN_HOST))?.['session']).toBe('sess-B');
  }));

  test('an unknown host pid with no match falls to the global newest', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    expect(latestContext(serverView(s, 9999))?.['session']).toBe('sess-B');
  }));

  test('no pid match: the launch session named by CLAUDE_CODE_SESSION_ID comes next', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    // A server behind a wrapper: its parent is not the host, but its launch session is A.
    expect(latestContext(serverView(s, 9999, { CLAUDE_CODE_SESSION_ID: 'sess-A' }))?.['session']).toBe('sess-A');
  }));

  test('a pid reused from a dead host is not matched: its rows predate the server', () => withStore(s => {
    // A dead host, pid 1001, wrote a turn before this server started…
    onUserPromptSubmit(hookView(s, 1001), { session_id: 'sess-dead', prompt_id: 'd1' },
                       new Date(START.getTime() - 3_600_000));
    promptSubmit(s, 2002, 'sess-B', 'b1', 1);
    // …so the new host that inherited pid 1001, with no turn of its own yet, does not adopt it.
    expect(latestContext(serverView(s, 1001))?.['session']).toBe('sess-B');
    promptSubmit(s, 1001, 'sess-new', 'n1', 2);
    expect(latestContext(serverView(s, 1001))?.['session']).toBe('sess-new');
  }));

  test('a caller-supplied session is still always believed', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'x', position: 'close', session: 'sess-B' });
    expect(lastStamp(s)).toEqual(['sess-B', 'b1']);
  }));

  test('express with an explicit session satisfies that session\'s Stop gate', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 2002, 'sess-B', 'b1', 2);
    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'x', position: 'close', session: 'sess-A' });
    expect(hasClosingSignature(s, 'sess-A', 'a1')).toBe(true);
    expect(onStop(hookView(s, 1001), { session_id: 'sess-A', prompt_id: 'a1' })).toBeNull();
  }));

  test('a row written with no host at all stores NULL and never matches a host', () => withStore(s => {
    recordContext(s, { session: 'sess-Z', promptId: 'z1', source: 'hook' }, at(1));
    expect(s.db.prepare('SELECT host_pid FROM turn_context').get()?.['host_pid']).toBeNull();
    expect(latestContext(serverView(s, 1001, { CLAUDE_CODE_SESSION_ID: 'none' }))?.['session']).toBe('sess-Z');
  }));

});

describe('the stopping turn is the one its close was filed under', () => {

  test('two prompts in one turn: a close after the second satisfies a Stop naming either', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 1001, 'sess-A', 'a2', 2);   // the interjected follow-up
    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'x', position: 'close' });
    expect(lastStamp(s)).toEqual(['sess-A', 'a2']);
    expect(onStop(hookView(s, 1001), { session_id: 'sess-A', prompt_id: 'a1' })).toBeNull();
    expect(onStop(hookView(s, 1001), { session_id: 'sess-A', prompt_id: 'a2' })).toBeNull();
  }));

  test('two prompts in one turn, never closed: still refused', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    promptSubmit(s, 1001, 'sess-A', 'a2', 2);
    expect(onStop(hookView(s, 1001), { session_id: 'sess-A', prompt_id: 'a1' })?.['decision']).toBe('block');
  }));

  test('a later begin_turn row cannot move which turn the gate checks', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    handleBeginTurn(serverView(s, 1001), { session: 'sess-A', promptId: 'invented' });
    expect(stoppedTurnPrompt(s, 'sess-A', 'a1')).toBe('a1');
  }));

  test('a turn no hook observed (bash mode) is allowed: its close is unknowable', () => withStore(s => {
    promptSubmit(s, 1001, 'sess-A', 'a1', 1);
    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'first', position: 'close' });
    // `! cmd` starts turn a9 with no UserPromptSubmit; its close lands on a1 again.
    handleExpress(serverView(s, 1001), VERSION, { channel: 'signature', text: 'second', position: 'close' });
    expect(stoppedTurnPrompt(s, 'sess-A', 'a9')).toBeNull();
    expect(stopTurn(s, { session_id: 'sess-A', prompt_id: 'a9' })).toBeNull();
    expect(onStop(hookView(s, 1001), { session_id: 'sess-A', prompt_id: 'a9' })).toBeNull();
  }));

  test('a hookless session keeps the payload prompt, so the gate still enforces', () => withStore(s => {
    handleBeginTurn(s, { session: 'sess-H', promptId: 'h1' });
    expect(stoppedTurnPrompt(s, 'sess-H', 'h2')).toBe('h2');
    expect(onStop(s, { session_id: 'sess-H', prompt_id: 'h2' })?.['decision']).toBe('block');
  }));

});

describe('the v8 → v9 migration', () => {

  test('adds host_pid and its index, keeps old rows, and re-running is a no-op', () => {
    const dir  = mkdtempSync(join(tmpdir(), 'se-host-mig-')),
          path = join(dir, 'log.sqlite3'),
          v8   = buildV8(path);
    expect(hasColumn(v8, 'turn_context', 'host_pid')).toBe(false);
    v8.prepare("INSERT INTO turn_context (ts_utc, session, prompt_id, source) VALUES ('2026-09-20T00:00:00Z','old','p-old','hook')").run();
    v8.close();

    const s = openStore(path);
    try {
      expect(readMeta(s, 'schema_version')).toBe(String(SCHEMA_VERSION));
      expect(hasColumn(s.db, 'turn_context', 'host_pid')).toBe(true);
      expect(s.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_context_host'").get())
        .toBeDefined();
      expect(s.db.prepare("SELECT host_pid FROM turn_context WHERE session = 'old'").get()?.['host_pid']).toBeNull();
      expect(() => { migrate(s.db, 8, 9); }).not.toThrow();
      // The old row is still the global fallback for a host that has written nothing.
      expect(latestContext(serverView(s, 1001))?.['session']).toBe('old');
    } finally {
      closeStore(s); rmSync(dir, { recursive: true, force: true });
    }
  });

});
