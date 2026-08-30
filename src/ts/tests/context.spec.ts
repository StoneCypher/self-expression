/**
 * Unit tests for the turn-context bridge: the `source` column that keeps an observed row
 * distinguishable from a volunteered one, the turn-identity lookup, the at-most-once
 * record that makes `begin_turn` idempotent, and the vocabulary the read surfaces use
 * when there is no context at all.
 *
 * @see ../channels/context.js
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, test, expect } from 'vitest';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import {
  recordContext, recordContextOnce, contextForTurn, latestContext, turnCount,
  noContextNotice, NO_HOOK_SESSION, UNKNOWN_CONTEXT, UNKNOWN_PREVIOUS,
} from '../channels/context.js';
import { CONTEXT_SOURCES } from '../channels/vocabulary.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-context-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Every turn_context row, oldest first. */
function rows(s: Store): Record<string, unknown>[] {
  return s.db.prepare('SELECT * FROM turn_context ORDER BY id').all();
}

describe('the source column — observed and volunteered are different evidence', () => {

  test('the vocabulary is exactly the two paths that exist', () => {
    expect([...CONTEXT_SOURCES]).toEqual(['hook', 'tool']);
  });

  test('recordContext stores whichever source it was handed', () => withStore(s => {
    recordContext(s, { session: 's1', promptId: 'p-1', source: 'hook' });
    recordContext(s, { session: 's1', promptId: 'p-2', source: 'tool' });
    expect(rows(s).map(r => r['source'])).toEqual(['hook', 'tool']);
  }));

  test('a caller that names no source stores NULL rather than a guess', () => withStore(s => {
    recordContext(s, { session: 's1', promptId: 'p-1' });
    expect(rows(s)[0]?.['source']).toBeNull();
  }));

  test('every other column still round-trips beside it', () => withStore(s => {
    recordContext(s, {
      session: 's1', promptId: 'p-1', turnIndex: 3, turn: 'reply', cwd: '/repo',
      gitBranch: 'main', permissionMode: 'acceptEdits', agentId: 'a1', agentType: 'general',
      effort: 'high', compactions: 2, promptLen: 140, source: 'tool',
    });
    const row = rows(s)[0];
    expect(row?.['turn_index']).toBe(3);
    expect(row?.['turn']).toBe('reply');
    expect(row?.['cwd']).toBe('/repo');
    expect(row?.['git_branch']).toBe('main');
    expect(row?.['permission_mode']).toBe('acceptEdits');
    expect(row?.['agent_id']).toBe('a1');
    expect(row?.['agent_type']).toBe('general');
    expect(row?.['effort']).toBe('high');
    expect(row?.['compactions']).toBe(2);
    expect(row?.['prompt_len']).toBe(140);
    expect(row?.['source']).toBe('tool');
  }));

});

describe('contextForTurn — turn identity is the (session, promptId) pair', () => {

  test('null before the turn is recorded, the row afterwards', () => withStore(s => {
    expect(contextForTurn(s, 's1', 'p-1')).toBeNull();
    recordContext(s, { session: 's1', promptId: 'p-1', source: 'hook' });
    expect(contextForTurn(s, 's1', 'p-1')?.['source']).toBe('hook');
  }));

  test('the session is part of the identity — a same-named turn elsewhere does not match', () => withStore(s => {
    recordContext(s, { session: 's1', promptId: 'p-1', source: 'hook' });
    expect(contextForTurn(s, 's2', 'p-1')).toBeNull();
  }));

  test('an absent or empty promptId is not an identity and never matches', () => withStore(s => {
    recordContext(s, { session: 's1', source: 'tool' });
    expect(contextForTurn(s, 's1', undefined)).toBeNull();
    expect(contextForTurn(s, 's1', '')).toBeNull();
  }));

});

describe('recordContextOnce — idempotent within a turn', () => {

  test('the first call records; a second for the same turn writes nothing', () => withStore(s => {
    const first  = recordContextOnce(s, { session: 's1', promptId: 'p-1', source: 'tool' }),
          second = recordContextOnce(s, { session: 's1', promptId: 'p-1', source: 'tool' });
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(rows(s)).toHaveLength(1);
  }));

  test('the standing row is returned unchanged by the second call — one turn, one identity', () => withStore(s => {
    const first  = recordContextOnce(s, { session: 's1', promptId: 'p-1', source: 'tool' }),
          second = recordContextOnce(s, { session: 's1', promptId: 'p-1', source: 'tool' });
    expect(second.row?.['id']).toBe(first.row?.['id']);
    expect(second.row?.['turn_index']).toBe(first.row?.['turn_index']);
  }));

  test('a hook row already there is adopted, not duplicated, and keeps its source', () => withStore(s => {
    recordContext(s, { session: 's1', promptId: 'p-1', turnIndex: 1, source: 'hook' });
    const result = recordContextOnce(s, { session: 's1', promptId: 'p-1', source: 'tool' });
    expect(result.recorded).toBe(false);
    expect(result.row?.['source']).toBe('hook');
    expect(rows(s)).toHaveLength(1);
  }));

  test('the turn index is derived from the record, never accepted', () => withStore(s => {
    expect(recordContextOnce(s, { session: 's1', promptId: 'p-1' }).row?.['turn_index']).toBe(1);
    expect(recordContextOnce(s, { session: 's1', promptId: 'p-2' }).row?.['turn_index']).toBe(2);
    expect(recordContextOnce(s, { session: 's1', promptId: 'p-3' }).row?.['turn_index']).toBe(3);
    expect(turnCount(s, 's1')).toBe(3);
  }));

  test('a repeated call does not advance the index — that is what "no forked turn" means', () => withStore(s => {
    recordContextOnce(s, { session: 's1', promptId: 'p-1' });
    recordContextOnce(s, { session: 's1', promptId: 'p-1' });
    recordContextOnce(s, { session: 's1', promptId: 'p-2' });
    expect(rows(s).map(r => r['turn_index'])).toEqual([1, 2]);
  }));

  test('two sessions count their own turns and never collide', () => withStore(s => {
    recordContextOnce(s, { session: 's1', promptId: 'p-1' });
    recordContextOnce(s, { session: 's2', promptId: 'p-1' });
    expect(contextForTurn(s, 's1', 'p-1')?.['turn_index']).toBe(1);
    expect(contextForTurn(s, 's2', 'p-1')?.['turn_index']).toBe(1);
    expect(rows(s)).toHaveLength(2);
  }));

  test('a turn with no identity always records, and says so', () => withStore(s => {
    expect(recordContextOnce(s, { session: 's1' }).recorded).toBe(true);
    expect(recordContextOnce(s, { session: 's1' }).recorded).toBe(true);
    expect(rows(s)).toHaveLength(2);
  }));

  test('latestContext sees the row the once-recorder wrote', () => withStore(s => {
    recordContextOnce(s, { session: 's1', promptId: 'p-1', effort: 'high', source: 'tool' });
    expect(latestContext(s)?.['effort']).toBe('high');
    expect(latestContext(s, 's1')?.['source']).toBe('tool');
  }));

});

describe('degrading loudly — the vocabulary for an absence', () => {

  test('both unknowns lead with the word turn_signed already uses', () => {
    expect(UNKNOWN_CONTEXT.startsWith('unknown')).toBe(true);
    expect(UNKNOWN_PREVIOUS.startsWith('unknown')).toBe(true);
  });

  test('the context message denies the wrong reading explicitly and names the fix', () => {
    expect(UNKNOWN_CONTEXT).toContain('nothing was happening');
    expect(UNKNOWN_CONTEXT).toContain('begin_turn');
  });

  test('the previous-signature message distinguishes unsearched from empty', () => {
    expect(UNKNOWN_PREVIOUS).toContain('nothing was checked');
    expect(UNKNOWN_PREVIOUS).toContain('begin_turn');
  });

  test('noContextNotice is silent for a real session and loud for the placeholder', () => {
    expect(noContextNotice('sess-1')).toBe('');
    expect(noContextNotice(NO_HOOK_SESSION)).toContain(NO_HOOK_SESSION);
    expect(noContextNotice(NO_HOOK_SESSION)).toContain('begin_turn');
  });

});
