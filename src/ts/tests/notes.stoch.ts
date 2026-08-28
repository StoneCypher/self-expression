/**
 * Stochastic property tests for held notes (issue #43).
 *
 * Three families, in descending order of how much the design rests on them:
 *
 * 1. **The delivery gate.** For *arbitrary* interleavings of composing, reply turns,
 *    wakeups, withdrawals, and deliberately forged surfacing attempts: every recorded
 *    `surfaced` event is preceded by an `offered` event on the same note, with the same
 *    `prompt_id`, stamped `reply` by the hook. This is the property the whole feature
 *    exists to guarantee — "no sequence of operations produces a delivery claim the hook
 *    did not authorize" — and it is checked against the real ledger, never a model of it.
 * 2. **Budgets are ceilings.** Under the same arbitrary sequences: nothing surfaces more
 *    than `daily_cap` times in the window, no note is offered more than `offer_cap`
 *    times, and the queue never exceeds `max_pending`.
 * 3. **The state rule.** {@link deriveNoteState} is pure, total over the closed
 *    vocabulary, and treats a recorded terminal event as absorbing.
 *
 * Plus a migration family: any v4 database reaches v5 without a single message value
 * changing, and without any pre-existing message being reclassified as a held note.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore, writeConfig, readMeta } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  composeNote, withdrawNote, surfaceNote, offerRipeNotes, listNotes, pendingNotes,
  deriveNoteState, noteBudgets, surfacedRecently,
} from '../channels/notes.js';
import { handleSurfaceNote }   from '../mcp/note_tools.js';
import { onUserPromptSubmit }  from '../mcp/hooks.js';
import { unreadCounts }        from '../channels/messages.js';
import { NOTE_STATES, NOTE_EVENTS, TURNS } from '../channels/vocabulary.js';
import { SCHEMA_VERSION }      from '../channels/schema.js';
import { buildV4, insertV4Message } from './helpers/v4_fixture.js';

const VERSION = '0.0.0-stoch';
const NOW     = new Date('2026-08-28T12:00:00Z');

/** One thing a run can do to the mailbox. */
type Op =
  | { readonly kind: 'compose';      readonly text: string; readonly delayDays: number;
      readonly series: string | null }
  | { readonly kind: 'replyTurn';    readonly surface: boolean }
  | { readonly kind: 'wakeup' }
  | { readonly kind: 'forgeSurface'; readonly id: number }
  | { readonly kind: 'withdraw';     readonly id: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind      : fc.constant('compose' as const),
    text      : fc.string({ minLength: 1, maxLength: 24 }).filter(t => t.trim() !== ''),
    delayDays : fc.integer({ min: 0, max: 3 }),
    series    : fc.option(fc.constantFrom('alpha', 'beta'), { nil: null }),
  }),
  fc.record({ kind: fc.constant('replyTurn' as const), surface: fc.boolean() }),
  fc.record({ kind: fc.constant('wakeup' as const) }),
  fc.record({ kind: fc.constant('forgeSurface' as const), id: fc.integer({ min: 1, max: 6 }) }),
  fc.record({ kind: fc.constant('withdraw' as const),     id: fc.integer({ min: 1, max: 6 }) }),
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 14 });

/** Every ledger row, in recording order — the ground truth every property reads. */
function ledger(store: Store): { id: number; note: number; event: string;
                                 turn: string | null; prompt: string | null }[] {
  return store.db.prepare(
    'SELECT id, note_id, event, turn, prompt_id FROM note_events ORDER BY id')
    .all().map(row => ({
      id     : Number(row['id']),
      note   : Number(row['note_id']),
      event  : String(row['event']),
      turn   : row['turn']      === null ? null : String(row['turn']),
      prompt : row['prompt_id'] === null ? null : String(row['prompt_id']),
    }));
}

/** Run one arbitrary operation sequence against a real store, on a pinned clock. */
function drive(store: Store, ops: readonly Op[]): void {

  let prompts = 0;

  for (const op of ops) {

    if (op.kind === 'compose') {
      // Composition legitimately refuses at the queue cap and on a supersede-free
      // duplicate; a refusal is a valid outcome, never a reason to stop the run.
      try {
        composeNote(store, {
          text      : op.text,
          reason    : 'stochastic',
          session   : 'sess-1',
          seriesKey : op.series ?? undefined,
          notBefore : new Date(NOW.getTime() + op.delayDays * 86_400_000).toISOString(),
        }, VERSION, NOW);
      } catch { /* refused; the invariants below still have to hold */ }
      continue;
    }

    if (op.kind === 'replyTurn') {
      prompts += 1;
      const prompt = `p-${String(prompts)}`;
      // The real hook path: it writes the turn context AND performs the offer, which is
      // exactly how offers reach the ledger in production.
      onUserPromptSubmit(store, { session_id: 'sess-1', prompt_id: prompt }, NOW);
      if (op.surface) {
        for (const view of listNotes(store, { limit: 200 }, NOW)) {
          if (view.state !== 'offered') { continue; }
          try { handleSurfaceNote(store, { id: view.id }); }
          catch { /* a cap or a race may refuse; that is the point of the invariants */ }
        }
      }
      continue;
    }

    if (op.kind === 'wakeup') {
      prompts += 1;
      const turn = TURNS[1 + (prompts % 3)] ?? 'wakeup';
      expect(offerRipeNotes(store, { turn, promptId: `w-${String(prompts)}` }, NOW)).toEqual([]);
      continue;
    }

    if (op.kind === 'forgeSurface') {
      // A delivery claim for a turn that never offered anything must always be refused.
      expect(() => surfaceNote(store, op.id, { turn: 'reply', promptId: `forged-${String(op.id)}` }, NOW))
        .toThrow();
      continue;
    }

    try { withdrawNote(store, op.id, {}, NOW); }
    catch { /* already terminal, or never existed */ }

  }

}

function withMailbox(seed: number, fn: (s: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), `se-notes-stoch-${String(seed)}-`));
  let store: Store | null = null;
  try {
    store = openStore(join(dir, 'log.sqlite3'));
    writeConfig(store, 'mailbox.enabled', 'true');
    fn(store);
  } finally {
    // Close before removing, on every path: Windows refuses to unlink a file an open
    // sqlite handle still holds, and an EBUSY here would bury the real failure.
    if (store !== null) { closeStore(store); }
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the delivery gate holds under arbitrary operation sequences', () => {

  it('every surfaced note was offered on that exact turn, by the hook, as a reply', () => {
    let run = 0;
    fc.assert(fc.property(opsArb, (ops) => {

      run += 1;
      withMailbox(run, store => {

        drive(store, ops);

        const rows    = ledger(store),
              offers  = rows.filter(r => r.event === 'offered'),
              claims  = rows.filter(r => r.event === 'surfaced');

        // Every offer is a hook fact: there is no other writer of this event.
        for (const offer of offers) { expect(offer.turn).toBe('reply'); }

        // And every delivery claim points back at one of them, on the same turn.
        for (const claim of claims) {
          const authorized = offers.some(offer =>
            offer.note === claim.note && offer.prompt === claim.prompt && offer.id < claim.id);
          expect(authorized).toBe(true);
        }

        // The mirror property: a note can be claimed delivered at most once.
        expect(new Set(claims.map(c => c.note)).size).toBe(claims.length);

      });

    }), { numRuns: 25 });
    // 25 property runs each build a real database on disk and drive up to fourteen
    // operations through it; the default 5s vitest timeout is a flake margin under a
    // concurrent build, not a correctness bound.
  }, 60_000);

  it('budgets are ceilings, not intentions', () => {
    let run = 0;
    fc.assert(fc.property(opsArb, (ops) => {

      run += 1;
      withMailbox(1000 + run, store => {

        drive(store, ops);

        const budgets = noteBudgets(store),
              views   = listNotes(store, { limit: 200 }, NOW);

        expect(surfacedRecently(store, NOW)).toBeLessThanOrEqual(budgets.dailyCap);
        expect(pendingNotes(store, NOW).length).toBeLessThanOrEqual(budgets.maxPending);

        for (const view of views) {
          expect(view.offerCount).toBeLessThanOrEqual(budgets.offerCap);
          expect(NOTE_STATES).toContain(view.state);
        }

        // Held notes never leak into the ordinary unread-mail count, whatever happened.
        expect(unreadCounts(store, 'sess-1', NOW).forUser).toBe(0);

      });

    }), { numRuns: 25 });
  }, 60_000);

  it('a terminal state is absorbing: nothing after it ever changes the answer', () => {
    let run = 0;
    fc.assert(fc.property(opsArb, opsArb, (first, second) => {

      run += 1;
      withMailbox(2000 + run, store => {

        drive(store, first);

        const before = new Map(listNotes(store, { limit: 200 }, NOW)
          .filter(v => v.state === 'surfaced' || v.state === 'withdrawn' || v.state === 'expired')
          .map(v => [v.id, v.state]));

        drive(store, second);

        for (const view of listNotes(store, { limit: 200 }, NOW)) {
          const was = before.get(view.id);
          if (was !== undefined) { expect(view.state).toBe(was); }
        }

      });

    }), { numRuns: 20 });
  }, 60_000);

});

describe('deriveNoteState', () => {

  const terminalArb = fc.constantFrom('surfaced' as const, 'withdrawn' as const, 'expired' as const);

  it('is total over the closed vocabulary — every input yields a real state', () => {
    fc.assert(fc.property(
      fc.option(fc.constantFrom(...NOTE_EVENTS), { nil: null }),
      fc.option(fc.constantFrom(...NOTE_EVENTS), { nil: null }),
      fc.nat({ max: 10 }),
      fc.integer({ min: 1, max: 5 }),
      fc.constantFrom('2000-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z'),
      (terminal, last, offerCount, cap, expires) => {
        const state = deriveNoteState(
          { terminalEvent: terminal, lastEvent: last, offerCount, expiresUtc: expires },
          cap, NOW.toISOString());
        expect(NOTE_STATES).toContain(state);
        expect(state).not.toBe('read');
      }));
  });

  it('a recorded terminal event wins over every derived death, for any clock or cap', () => {
    fc.assert(fc.property(
      terminalArb, fc.nat({ max: 20 }), fc.integer({ min: 1, max: 5 }),
      fc.constantFrom('2000-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z'),
      (terminal, offerCount, cap, expires) => {
        expect(deriveNoteState(
          { terminalEvent: terminal, lastEvent: terminal, offerCount, expiresUtc: expires },
          cap, NOW.toISOString())).toBe(terminal);
      }));
  });

  it('offers only ever move a live note toward expiry, never away from it', () => {
    fc.assert(fc.property(
      fc.nat({ max: 9 }), fc.integer({ min: 1, max: 5 }),
      (offerCount, cap) => {
        const at   = deriveNoteState({ terminalEvent: null, lastEvent: 'declined', offerCount,
                                       expiresUtc: '2099-01-01T00:00:00.000Z' }, cap, NOW.toISOString()),
              more = deriveNoteState({ terminalEvent: null, lastEvent: 'declined',
                                       offerCount: offerCount + 1,
                                       expiresUtc: '2099-01-01T00:00:00.000Z' }, cap, NOW.toISOString());
        if (at === 'expired') { expect(more).toBe('expired'); }
      }));
  });

});

describe('v4→v5 migration — stochastic losslessness', () => {

  const messagesArb = fc.array(
    fc.record({
      text     : fc.string({ minLength: 1, maxLength: 30 }),
      audience : fc.constantFrom('self', 'agents', 'user', 'record'),
    }), { minLength: 1, maxLength: 8 });

  it('migrates any v4 database without changing a message, or making one a note', () => {
    let run = 0;
    fc.assert(fc.property(messagesArb, (rows) => {

      run += 1;
      const dir  = mkdtempSync(join(tmpdir(), `se-note-migrate-${String(run)}-`)),
            path = join(dir, 'log.sqlite3');

      let store: Store | null = null;

      try {

        const v4 = buildV4(path);
        for (const [index, row] of rows.entries()) {
          // 'agents' requires a box in the validated path, but this is raw v4 SQL, which
          // is exactly how such rows genuinely reached a v4 database.
          insertV4Message(v4, `m-${String(index)}`, row.text, row.audience);
        }
        const before = JSON.parse(JSON.stringify(
          v4.prepare('SELECT id, uuid, audience, text, expires_utc FROM messages ORDER BY id')
            .all())) as unknown;
        v4.close();

        store = openStore(path);
        const after = JSON.parse(JSON.stringify(
          store.db.prepare('SELECT id, uuid, audience, text, expires_utc FROM messages ORDER BY id')
            .all())) as unknown;

        expect(after).toEqual(before);
        expect(readMeta(store, 'schema_version')).toBe(String(SCHEMA_VERSION));

        // Nothing pre-existing was reclassified: the note tables arrive empty, and the
        // held-note facility works through the normal path afterward.
        expect(listNotes(store)).toHaveLength(0);
        writeConfig(store, 'mailbox.enabled', 'true');
        composeNote(store, { text: 'post-migration', reason: 'r', session: 's1' }, VERSION, NOW);
        expect(listNotes(store)).toHaveLength(1);

      } finally {
        if (store !== null) { closeStore(store); }
        rmSync(dir, { recursive: true, force: true });
      }

    }), { numRuns: 20 });
  }, 60_000);

});
