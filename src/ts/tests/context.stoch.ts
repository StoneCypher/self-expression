/**
 * Stochastic property tests for turn-context recording, through the real `begin_turn`
 * handler against a real store — never a hand-built expected object.
 *
 * Three invariants carry the whole design, and each is stated as a property because each
 * is a claim about *every* call sequence, not about one:
 *
 * - **one turn, one row.** However many times a turn is begun, in whatever interleaving
 *   with other turns and other sessions, `turn_context` holds exactly one row per
 *   distinct (session, promptId) pair that was ever named;
 * - **the index is a count, not a claim.** A session's turn indices are unique and
 *   positive, and a session begun only through the tool numbers its turns 1..n in
 *   first-mention order however often each is re-begun;
 * - **provenance survives.** A row the hook wrote is never restamped by a later
 *   `begin_turn`, in any order.
 *
 * **One store per property, not one per run.** Each fast-check run gets its own session
 * namespace instead of its own database file: a hundred `openStore` calls per property is
 * a hundred directory creations and a hundred SQLite files, which costs minutes and buys
 * nothing the namespace does not. Sessions are the isolation boundary the code itself
 * uses — `turnCount`, `latestContext`, and the dedupe lookup are all session-scoped — so
 * separating runs by session separates them exactly as far as the invariants reach.
 *
 * @see ../channels/context.js recordContextOnce
 * @see ../mcp/tools.js handleBeginTurn
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { recordContext, contextForTurn } from '../channels/context.js';
import { handleBeginTurn } from '../mcp/tools.js';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-context-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** How many runs each property takes; enough to interleave, cheap enough to keep. */
const RUNS = 60;

/** One randomized turn-start, as fast-check generates them. */
interface Call {
  readonly session : string;
  readonly prompt  : string;
  readonly byHook  : boolean;
}

const callArb: fc.Arbitrary<Call> = fc.record({
  session : fc.constantFrom('s1', 's2', 's3'),
  prompt  : fc.constantFrom('p1', 'p2', 'p3', 'p4'),
  byHook  : fc.boolean(),
});

/** A fresh session namespace, so one store can carry every run of a property. */
function namespacer(): () => string {
  let run = 0;
  return (): string => { run += 1; return `r${String(run)}-`; };
}

/** Every turn_context row written under one namespace, oldest first. */
function rowsUnder(s: Store, tag: string): Record<string, unknown>[] {
  return s.db.prepare('SELECT * FROM turn_context WHERE session LIKE ? ORDER BY id')
    .all(`${tag}%`);
}

/**
 * Replay one generated sequence under its own session namespace, and hand back the rows
 * it produced.
 *
 * The hook path is routed through the same existence guard the tool uses, because that is
 * what a real host does: `UserPromptSubmit` fires once per real turn, so a second row for
 * one turn is not a thing the hook can produce either.
 */
function replay(s: Store, tag: string, calls: readonly Call[]): Record<string, unknown>[] {
  for (const call of calls) {
    const session = tag + call.session;
    if (call.byHook) {
      if (contextForTurn(s, session, call.prompt) === null) {
        recordContext(s, { session, promptId: call.prompt, source: 'hook' });
      }
    } else {
      handleBeginTurn(s, { session, promptId: call.prompt });
    }
  }
  return rowsUnder(s, tag);
}

describe('one turn, one row — however the two paths interleave', () => {

  it('the row count equals the number of distinct (session, prompt) pairs named', () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(fc.array(callArb, { maxLength: 20 }), calls => {
        const tag      = next(),
              distinct = new Set(calls.map(c => `${c.session} ${c.prompt}`));
        expect(replay(s, tag, calls)).toHaveLength(distinct.size);
      }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

  it('no (session, prompt) pair ever appears twice', () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(fc.array(callArb, { minLength: 1, maxLength: 20 }), calls => {
        const keys = replay(s, next(), calls)
          .map(r => `${String(r['session'])} ${String(r['prompt_id'])}`);
        expect(new Set(keys).size).toBe(keys.length);
      }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

  it('every pair that was named is present — deduplication never drops a turn', () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(fc.array(callArb, { maxLength: 20 }), calls => {
        const tag    = next(),
              stored = new Set(replay(s, tag, calls)
                .map(r => `${String(r['session'])} ${String(r['prompt_id'])}`));
        for (const call of calls) {
          expect(stored.has(`${tag}${call.session} ${call.prompt}`)).toBe(true);
        }
      }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

});

describe('the turn index is a count of the record, never a caller claim', () => {

  it("each session's indices are unique and positive, whatever the interleaving", () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(fc.array(callArb, { maxLength: 20 }), calls => {

        const bySession = new Map<string, number[]>();

        for (const row of replay(s, next(), calls)) {
          const session = String(row['session']),
                index   = row['turn_index'];
          // The hook path in this replay supplies no index, so only tool-written rows
          // carry one; those are the rows the derivation claim is about.
          if (typeof index === 'number') {
            bySession.set(session, [...bySession.get(session) ?? [], index]);
          }
        }

        for (const indices of bySession.values()) {
          expect(new Set(indices).size).toBe(indices.length);
          for (const index of indices) { expect(index).toBeGreaterThan(0); }
        }

      }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

  it('a session begun only through the tool numbers its turns 1..n in order', () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(
        fc.uniqueArray(fc.constantFrom('p1', 'p2', 'p3', 'p4', 'p5'), { minLength: 1, maxLength: 5 }),
        fc.array(fc.nat({ max: 4 }), { maxLength: 12 }),
        (prompts, repeats) => {

          const session = `${next()}s1`;

          for (const prompt of prompts) { handleBeginTurn(s, { session, promptId: prompt }); }

          // Re-begin arbitrary already-begun turns; none of it may move a number.
          for (const at of repeats) {
            const prompt = prompts[at % prompts.length];
            if (prompt !== undefined) { handleBeginTurn(s, { session, promptId: prompt }); }
          }

          const written = s.db.prepare(
            'SELECT prompt_id, turn_index FROM turn_context WHERE session = ? ORDER BY id')
            .all(session);

          expect(written.map(r => r['turn_index'])).toEqual(prompts.map((_, i) => i + 1));
          expect(written.map(r => r['prompt_id'])).toEqual([...prompts]);

        }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

});

describe('provenance survives every ordering', () => {

  it('a turn the hook observed stays marked hook, however often begin_turn is called on it', () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(fc.array(callArb, { maxLength: 20 }), calls => {

        const tag     = next(),
              firstBy = new Map<string, 'hook' | 'tool'>();

        for (const call of calls) {
          const key = `${tag}${call.session} ${call.prompt}`;
          if (!firstBy.has(key)) { firstBy.set(key, call.byHook ? 'hook' : 'tool'); }
        }

        for (const row of replay(s, tag, calls)) {
          expect(row['source'])
            .toBe(firstBy.get(`${String(row['session'])} ${String(row['prompt_id'])}`));
        }

      }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

  it('every row either path wrote carries one of the two sources, never NULL', () => {
    withStore(s => {
      const next = namespacer();
      fc.assert(fc.property(fc.array(callArb, { minLength: 1, maxLength: 20 }), calls => {
        for (const row of replay(s, next(), calls)) {
          expect(['hook', 'tool']).toContain(String(row['source']));
        }
      }), { numRuns: RUNS });
    });
  }, 60_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

});
