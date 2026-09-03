/**
 * Unit tests for `channels/desk_questions.ts`.
 *
 * Every test writes to a real temp directory and calls the real module against it — the
 * whole point of this module is that the desk server (`panel.mjs`) is the other writer of
 * the same file, so a mocked filesystem would test the claim by assuming it.
 */

import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import {
  questionsPath, readQuestions, writeQuestions, openIntents, claimIntent,
} from '../channels/desk_questions.js';
import type { DeskQuestion } from '../channels/desk_questions.js';

const T  = '2026-08-30T12:00:00.000Z';
const T2 = '2026-08-30T12:05:00.000Z';

/**
 * Run `fn` against a fresh temp desk directory, cleaned up afterwards even on failure.
 *
 * @param fn the test body, given the desk directory
 * @returns whatever `fn` returns
 */
function withDesk<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-desk-questions-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('questionsPath', () => {

  test('joins the desk dir with questions.json', () => {
    expect(questionsPath('C:/desk')).toBe(join('C:/desk', 'questions.json'));
  });

});

describe('readQuestions', () => {

  test('returns [] for a missing file', () => {
    withDesk(dir => { expect(readQuestions(dir)).toEqual([]); });
  });

  test('throws SyntaxError on corrupt JSON (does not swallow)', () => {
    withDesk(dir => {
      writeFileSync(questionsPath(dir), '{not json');
      expect(() => readQuestions(dir)).toThrow(SyntaxError);
    });
  });

});

describe('openIntents', () => {

  test('keeps queued rows that are neither dismissed nor claimed', () => {
    const rows: DeskQuestion[] = [
      { id: 't1', text: 'a', asked: T, queued: 'next' },
      { id: 't2', text: 'b', asked: T, queued: 'agents', claimed: { session: 's', at: T } },
      { id: 't3', text: 'c', asked: T, queued: 'next', dismissed: true },
      { id: 't4', text: 'd', asked: T },
    ];
    expect(openIntents(rows).map(r => r.id)).toEqual(['t1']);
  });

});

describe('writeQuestions', () => {

  test('leaves no temp file behind', () => {
    withDesk(dir => {
      writeQuestions(dir, [{ id: 't1', text: 'a', asked: T }]);
      expect(readdirSync(dir)).toEqual(['questions.json']);
    });
  });

  test('round-trips rows through readQuestions', () => {
    withDesk(dir => {
      const rows: DeskQuestion[] = [{ id: 't1', text: 'a', asked: T, queued: 'next' }];
      writeQuestions(dir, rows);
      expect(readQuestions(dir)).toEqual(rows);
    });
  });

});

describe('claimIntent', () => {

  test('stamps claimed and preserves every other field', () => {
    withDesk(dir => {
      writeQuestions(dir, [
        { id: 't1', text: 'a', asked: T, queued: 'agents', options: ['x'], stuck: true },
      ]);
      const row = claimIntent(dir, 't1', 'sess-1', new Date(T2));
      expect(row?.claimed).toEqual({ session: 'sess-1', at: T2 });
      expect(readQuestions(dir)[0]).toMatchObject({
        options: ['x'], stuck: true, queued: 'agents', claimed: { session: 'sess-1', at: T2 },
      });
    });
  });

  test('returns null for an unknown id and leaves the file unchanged', () => {
    withDesk(dir => {
      const rows: DeskQuestion[] = [{ id: 't1', text: 'a', asked: T, queued: 'next' }];
      writeQuestions(dir, rows);
      const result = claimIntent(dir, 'nope', 'sess-1', new Date(T2));
      expect(result).toBeNull();
      expect(readQuestions(dir)).toEqual(rows);
    });
  });

  test('returns null for an already-claimed row and leaves the file unchanged', () => {
    withDesk(dir => {
      const rows: DeskQuestion[] = [
        { id: 't1', text: 'a', asked: T, queued: 'next', claimed: { session: 'other', at: T } },
      ];
      writeQuestions(dir, rows);
      const result = claimIntent(dir, 't1', 'sess-1', new Date(T2));
      expect(result).toBeNull();
      expect(readQuestions(dir)).toEqual(rows);
    });
  });

  test('claiming one row leaves a second open row untouched', () => {
    withDesk(dir => {
      writeQuestions(dir, [
        { id: 't1', text: 'a', asked: T, queued: 'next' },
        { id: 't2', text: 'b', asked: T, queued: 'agents' },
      ]);
      claimIntent(dir, 't1', 'sess-1', new Date(T2));
      const after = readQuestions(dir);
      expect(after.find(r => r.id === 't2')).toEqual({ id: 't2', text: 'b', asked: T, queued: 'agents' });
      expect(openIntents(after).map(r => r.id)).toEqual(['t2']);
    });
  });

});
