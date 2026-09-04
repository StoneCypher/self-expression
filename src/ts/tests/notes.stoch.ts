/**
 * Stochastic property tests for held notes (issue #43).
 *
 * Three families, in descending order of how much the design rests on them:
 *
 * 1. **The delivery gate.** For *arbitrary* interleavings of composing, reply turns,
 *    wakeups, withdrawals, and adversarial surfacing attempts: every recorded `surfaced`
 *    event points at an `offered` event that was **still outstanding** on a `reply` turn
 *    the **harness itself observed**, matching on the whole pair `(session, prompt_id)`.
 *    This is the property the whole feature exists to guarantee — "no sequence of
 *    operations produces a delivery claim the hook did not authorize" — and it is checked
 *    against the real ledger, never a model of it.
 *
 *    The forger is deliberately not a straw man. Forging a prompt id nobody ever issued
 *    tests almost nothing: the interesting attacker uses ids it legitimately saw (offers
 *    are shown to the model, and prompt ids ride ordinary tool replies), calls `begin_turn`
 *    to manufacture the turn context those ids belong to, names whatever session suits it,
 *    and tries after the offer has lapsed rather than before. Every one of those moves was
 *    a real hole; the property is what keeps them closed.
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
import { handleBeginTurn }     from '../mcp/tools.js';
import { onUserPromptSubmit }  from '../mcp/hooks.js';
import { unreadCounts }        from '../channels/messages.js';
import { NOTE_STATES, NOTE_EVENTS, TURNS } from '../channels/vocabulary.js';
import { SCHEMA_VERSION }      from '../channels/schema.js';
import { buildV4, insertV4Message } from './helpers/v4_fixture.js';

const VERSION = '0.0.0-stoch';
const NOW     = new Date('2026-08-28T12:00:00Z');

/** The session the honest half of a run works under; the hook stamps every turn with it. */
const REAL_SESSION = 'sess-1';

/**
 * The sessions a forging attempt may name — the real one included, because "claim the
 * right session but the wrong turn" is a distinct attack from "claim another session".
 */
const FORGE_SESSIONS = [REAL_SESSION, 'ghost', 'sess-2'] as const;

/** One thing a run can do to the mailbox. */
type Op =
  | { readonly kind: 'compose';      readonly text: string; readonly delayDays: number;
      readonly series: string | null }
  | { readonly kind: 'replyTurn';    readonly surface: boolean; readonly budget: number }
  | { readonly kind: 'wakeup' }
  | { readonly kind: 'forgeSurface'; readonly id: number; readonly session: number;
      readonly prompt: number; readonly beginTurn: boolean }
  | { readonly kind: 'withdraw';     readonly id: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind      : fc.constant('compose' as const),
    text      : fc.string({ minLength: 1, maxLength: 24 }).filter(t => t.trim() !== ''),
    delayDays : fc.integer({ min: 0, max: 3 }),
    series    : fc.option(fc.constantFrom('alpha', 'beta'), { nil: null }),
  }),
  fc.record({
    kind    : fc.constant('replyTurn' as const),
    surface : fc.boolean(),
    // The per-turn budget in force for this turn. A zero is what produces the state a
    // lapse-replay attack needs: a turn that lapses the previous offer without making a
    // new one, so `last_offer_prompt` goes on naming a turn whose offer is over.
    budget  : fc.integer({ min: 0, max: 2 }),
  }),
  fc.record({ kind: fc.constant('wakeup' as const) }),
  fc.record({
    kind      : fc.constant('forgeSurface' as const),
    // Kept near the ids a short run actually creates, so the attacks land on real notes
    // rather than spending most of their draws on ids nothing ever composed.
    id        : fc.integer({ min: 1, max: 4 }),
    // Which of the prompt ids this run has already put in front of the model to reuse —
    // real offers included, which is the whole point.
    prompt    : fc.nat({ max: 40 }),
    session   : fc.nat({ max: 5 }),
    // Whether to manufacture the turn context first, through the hookless host's door.
    beginTurn : fc.boolean(),
  }),
  fc.record({ kind: fc.constant('withdraw' as const),     id: fc.integer({ min: 1, max: 6 }) }),
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 14 });

/**
 * Every prompt id this run has already exposed — offers on the ledger and turns in the
 * context table both reach the model through ordinary replies, so both are fair game for
 * a forger, plus one id nobody ever issued as a control.
 */
function observedPrompts(store: Store): string[] {
  const fromLedger = store.db.prepare(
          'SELECT DISTINCT prompt_id FROM note_events WHERE prompt_id IS NOT NULL').all()
          .map(row => String(row['prompt_id'])),
        fromTurns  = store.db.prepare(
          'SELECT DISTINCT prompt_id FROM turn_context WHERE prompt_id IS NOT NULL').all()
          .map(row => String(row['prompt_id']));
  return [...new Set([...fromLedger, ...fromTurns, 'never-issued'])];
}

/** One `(session, prompt_id)` pair as a comparable key; JSON so no value can smuggle the joiner. */
function turnKey(session: string | null, promptId: string | null): string {
  return JSON.stringify([session, promptId]);
}

/** The `(session, prompt_id)` pairs the harness itself observed — the only ones that count. */
function hookObservedTurns(store: Store): Set<string> {
  return new Set(store.db.prepare(`
    SELECT session, prompt_id FROM turn_context
     WHERE source = 'hook' AND prompt_id IS NOT NULL`).all()
    .map(row => turnKey(String(row['session']), String(row['prompt_id']))));
}

/** Every note this run has ever offered — the full target list for a replay attack. */
function everOfferedNotes(store: Store): number[] {
  return store.db.prepare(
    "SELECT DISTINCT note_id FROM note_events WHERE event = 'offered' ORDER BY note_id").all()
    .map(row => Number(row['note_id']));
}

/**
 * The turn one note was last offered on — the exact pair a replay attack quotes back,
 * since it is a pair the model was genuinely shown.
 */
function lastOffer(store: Store, noteId: number): { prompt: string; session: string } | null {
  const row = store.db.prepare(`
    SELECT prompt_id, session FROM note_events
     WHERE note_id = ? AND event = 'offered' ORDER BY id DESC LIMIT 1`).get(noteId);
  return row === undefined || row['prompt_id'] === null
    ? null
    : { prompt: String(row['prompt_id']), session: String(row['session'] ?? '') };
}

/** One row of the append-only ledger, as the properties read it. */
interface LedgerRow {
  readonly id      : number;
  readonly note    : number;
  readonly event   : string;
  readonly turn    : string | null;
  readonly prompt  : string | null;
  readonly session : string | null;
}

/** Every ledger row, in recording order — the ground truth every property reads. */
function ledger(store: Store): LedgerRow[] {
  return store.db.prepare(
    'SELECT id, note_id, event, turn, prompt_id, session FROM note_events ORDER BY id')
    .all().map(row => ({
      id      : Number(row['id']),
      note    : Number(row['note_id']),
      event   : String(row['event']),
      turn    : row['turn']      === null ? null : String(row['turn']),
      prompt  : row['prompt_id'] === null ? null : String(row['prompt_id']),
      session : row['session']   === null ? null : String(row['session']),
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
          session   : REAL_SESSION,
          seriesKey : op.series ?? undefined,
          notBefore : new Date(NOW.getTime() + op.delayDays * 86_400_000).toISOString(),
        }, VERSION, NOW);
      } catch { /* refused; the invariants below still have to hold */ }
      continue;
    }

    if (op.kind === 'replyTurn') {
      prompts += 1;
      const prompt = `p-${String(prompts)}`;
      writeConfig(store, 'mailbox.surface_budget', String(op.budget));
      // The real hook path: it writes the turn context AND performs the offer, which is
      // exactly how offers reach the ledger in production.
      onUserPromptSubmit(store, { session_id: REAL_SESSION, prompt_id: prompt }, NOW);
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
      expect(offerRipeNotes(store, { turn, promptId: `w-${String(prompts)}`,
                                     session: REAL_SESSION }, NOW)).toEqual([]);
      continue;
    }

    if (op.kind === 'forgeSurface') {

      const seen    = observedPrompts(store),
            prompt  = seen[op.prompt % seen.length] ?? 'never-issued',
            session = FORGE_SESSIONS[op.session % FORGE_SESSIONS.length] ?? REAL_SESSION,
            targets = new Set<number>([op.id]);

      // Attack 1 — replay, against every note that was ever offered. Quote back the exact
      // turn each was last offered on, which is a pair the model was genuinely shown, and
      // manufacture the turn context for it through the hookless host's door. This is the
      // reported hole: it succeeds if and only if that offer is still outstanding on an
      // observed turn, which after any lapse it is not.
      for (const noteId of everOfferedNotes(store)) {

        const replay = lastOffer(store, noteId);

        if (replay === null) { continue; }

        if (op.beginTurn) {
          try { handleBeginTurn(store, { session: replay.session, promptId: replay.prompt }, NOW); }
          catch { /* a refusal is a fine outcome; the invariant is what matters */ }
        }
        try { handleSurfaceNote(store, { id: noteId, session: replay.session }); }
        catch { /* refused */ }
        try {
          surfaceNote(store, noteId,
                      { turn: 'reply', promptId: replay.prompt, session: replay.session }, NOW);
        } catch { /* refused */ }

      }

      // Attack 2 — a turn of the forger's own making, and an offer to go with it. Nothing
      // in production reaches that offer call; the hook is the only caller. But assuming
      // it stays the only caller is exactly the assumption a property test should refuse
      // to make, and it is what gives the hook-sourcing check something to bite on.
      if (op.beginTurn) {
        try { handleBeginTurn(store, { session, promptId: prompt }, NOW); }
        catch { /* refused */ }
        for (const view of offerRipeNotes(store, { turn: 'reply', promptId: prompt, session }, NOW)) {
          targets.add(view.id);
        }
      }

      // Both doors into the claim: the tool, which resolves the turn for itself, and the
      // library call, where the forger gets to state the whole turn. Neither is asserted
      // to throw — a forger that happens to name the real outstanding offer on the real
      // observed turn has simply surfaced a note, honestly. The property below is what
      // says every *recorded* claim was one of those.
      try { handleSurfaceNote(store, { id: op.id, session }); }
      catch { /* refused */ }

      for (const target of targets) {
        try { surfaceNote(store, target, { turn: 'reply', promptId: prompt, session }, NOW); }
        catch { /* refused */ }
      }

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

  it('every surfaced note held an outstanding offer on that exact observed turn', () => {
    let run = 0;
    fc.assert(fc.property(opsArb, (ops) => {

      run += 1;
      withMailbox(run, store => {

        drive(store, ops);

        const rows     = ledger(store),
              observed = hookObservedTurns(store),
              claims   = rows.filter(r => r.event === 'surfaced');

        // Every offer is a hook fact: there is no other writer of this event.
        for (const offer of rows.filter(r => r.event === 'offered')) {
          expect(offer.turn).toBe('reply');
        }

        for (const claim of claims) {

          // The offer it points at is the note's latest one before the claim.
          const offer = rows.filter(r =>
            r.note === claim.note && r.event === 'offered' && r.id < claim.id).pop();

          expect(offer).toBeDefined();
          if (offer === undefined) { continue; }

          // Stamped `reply` by the hook, and matching on the whole identity — a prompt id
          // alone is a token the model can read out of a reply and quote back.
          expect(offer.turn).toBe('reply');
          expect(offer.prompt).toBe(claim.prompt);
          expect(offer.session).toBe(claim.session);
          expect(claim.prompt).not.toBeNull();
          expect(claim.session).not.toBeNull();

          // Still outstanding: nothing at all happened to this note between the offer and
          // the claim, so no lapse, no sweep, and no second offer sits in between.
          expect(rows.some(r => r.note === claim.note && r.id > offer.id && r.id < claim.id))
            .toBe(false);

          // And the harness genuinely saw that turn. A `begin_turn` row for the same pair
          // is not this — that is the difference the `source` column exists to keep.
          expect([...observed]).toContain(turnKey(claim.session, claim.prompt));

        }

        // The mirror property: a note can be claimed delivered at most once.
        expect(new Set(claims.map(c => c.note)).size).toBe(claims.length);

      });

    }), { numRuns: 150 });
    // Far more runs than its siblings, because this one has to *reach* the states the
    // attacks exploit — a lapsed offer needs a turn that lapsed without re-offering, which
    // only a spent per-turn budget produces. Verified by removing each guard in turn and
    // watching the property fail; at 25 runs it did not, which made it a decoration.
  }, 120_000);

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
