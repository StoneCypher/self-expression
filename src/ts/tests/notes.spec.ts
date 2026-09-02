/**
 * Unit specs for held notes (issue #43).
 *
 * Every test drives the real store and the real state derivation; nothing asserts a
 * hand-built expected object against a hand-built actual one. The load-bearing group is
 * "the delivery discipline", which pins the property the whole feature exists for:
 * composing is free, and delivery is reachable only through a hook-stamped reply turn.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  composeNote, withdrawNote, surfaceNote, offerRipeNotes, ripeNotes, pendingNotes,
  listNotes, noteView, noteBudgets, mailboxEnabled, validateNote, deriveNoteState,
  sweepExpired, lapseStaleOffers, surfacedRecently, renderHeldNote, formatNotes,
  NOTE_REASON_MAX,
} from '../channels/notes.js';
import { unreadCounts, readMessages } from '../channels/messages.js';
import { recordContext }              from '../channels/context.js';
import { NOTE_STATES, NOTE_EVENTS }   from '../channels/vocabulary.js';

const VERSION = '0.2.1';

/** A fixed instant every timing assertion is anchored to. */
const NOW = new Date('2026-08-28T12:00:00Z');

/** The one session every note in these specs is composed under and offered to. */
const SESSION = 's1';

/** `n` days after {@link NOW}, for TTL and ripeness arithmetic. */
function plusDays(n: number): Date {
  return new Date(NOW.getTime() + n * 86_400_000);
}

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-notes-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** A store with the facility switched on — the consent gate, satisfied explicitly. */
function withMailbox<T>(fn: (s: Store) => T): T {
  return withStore(s => { writeConfig(s, 'mailbox.enabled', 'true'); return fn(s); });
}

/** Compose one ordinary note, with everything defaulted. */
function note(s: Store, text = 'run the reconcile step first', extra = {}): number {
  return composeNote(s, {
    text, reason: 'the deploy window opens Tuesday', session: SESSION, ...extra,
  }, VERSION, NOW).id;
}

/**
 * Write the `turn_context` row the `UserPromptSubmit` hook writes, `source: 'hook'` and
 * all — the evidence a later surfacing is checked against. Without it nothing authorises
 * a surface, which is the whole point of the gate.
 */
function hookTurn(s: Store, promptId: string, at: Date = NOW, session = SESSION): void {
  recordContext(s, { session, promptId, turn: 'reply', source: 'hook' }, at);
}

/** One whole reply turn as the harness performs it: observe the turn, then offer. */
function replyTurn(s: Store, promptId: string, at: Date = NOW) {
  hookTurn(s, promptId, at);
  return offerRipeNotes(s, { turn: 'reply', promptId, session: SESSION }, at);
}

/** The claim a model makes after rendering a note it was offered this turn. */
function surface(s: Store, id: number, promptId: string, at: Date = NOW) {
  return surfaceNote(s, id, { turn: 'reply', promptId, session: SESSION }, at);
}

describe('the consent gate', () => {

  test('the facility is off on a fresh install, and only an exact true enables it', () => withStore(s => {
    expect(mailboxEnabled(s)).toBe(false);
    writeConfig(s, 'mailbox.enabled', 'yes');
    expect(mailboxEnabled(s)).toBe(false);   // invalid override reads as the default
    writeConfig(s, 'mailbox.enabled', 'true');
    expect(mailboxEnabled(s)).toBe(true);
  }));

  test('composing into a switched-off mailbox fails loudly rather than queueing', () => withStore(s => {
    expect(() => note(s)).toThrow(/disabled/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM notes').get()?.['n']).toBe(0);
  }));

  test('a disabled mailbox offers nothing, whatever is queued', () => withStore(s => {
    writeConfig(s, 'mailbox.enabled', 'true');
    note(s);
    writeConfig(s, 'mailbox.enabled', 'false');
    expect(replyTurn(s, 'p-1')).toEqual([]);
  }));

  test('the budgets are the documented defaults', () => withStore(s => {
    expect(noteBudgets(s)).toEqual({
      surfaceBudget: 1, dailyCap: 3, maxPending: 10, offerCap: 3, defaultTtlDays: 14 });
  }));

  test('an out-of-range stored budget behaves as unset rather than as a limit nobody chose', () =>
    withStore(s => {
      writeConfig(s, 'mailbox.offer_cap', 'plenty');
      expect(noteBudgets(s).offerCap).toBe(3);
    }));

});

describe('composing', () => {

  test('a composed note is queued, with its own text and reason readable back', () => withMailbox(s => {
    const id   = note(s),
          view = noteView(s, id, NOW);
    expect(view?.state).toBe('queued');
    expect(view?.text).toBe('run the reconcile step first');
    expect(view?.reason).toBe('the deploy window opens Tuesday');
    expect(view?.offerCount).toBe(0);
  }));

  test('the TTL is mandatory: an unspecified expiry becomes now plus the default', () => withMailbox(s => {
    const view = noteView(s, note(s), NOW);
    expect(view?.expiresUtc).toBe(plusDays(14).toISOString());
  }));

  test('composing is legal on a wakeup turn, and the ledger records that it was one', () =>
    withMailbox(s => {
      const id = composeNote(s, { text: 'ripened at 2 am', reason: 'nobody was listening',
                                  session: 's1', turn: 'wakeup' }, VERSION, NOW).id;
      const events = s.db.prepare('SELECT event, turn FROM note_events WHERE note_id = ?').all(id);
      expect(events).toEqual([{ event: 'composed', turn: 'wakeup' }]);
      expect(noteView(s, id, NOW)?.state).toBe('queued');
    }));

  test('an empty reason is refused — a note with no stated cost is unauditable', () => withMailbox(s => {
    expect(() => composeNote(s, { text: 'x', reason: '   ', session: 's1' }, VERSION, NOW))
      .toThrow(/reason must not be empty/);
  }));

  test('an over-long reason is refused, naming the limit', () => withMailbox(s => {
    expect(() => composeNote(s, { text: 'x', reason: 'r'.repeat(NOTE_REASON_MAX + 1),
                                  session: 's1' }, VERSION, NOW))
      .toThrow(new RegExp(String(NOTE_REASON_MAX)));
  }));

  test('a note that would die before it ripened is refused, not silently queued', () => withMailbox(s => {
    expect(() => composeNote(s, {
      text: 'x', reason: 'r', session: 's1',
      notBefore: plusDays(10).toISOString(), expiresUtc: plusDays(2).toISOString(),
    }, VERSION, NOW)).toThrow(/could never be offered/);
  }));

  test('a notBefore past the default TTL is refused too, not queued already dead', () =>
    withMailbox(s => {
      // No expiresUtc at all: the note would ripen in a year and die in a fortnight, and
      // the old check never looked, because it only judged an expiry the caller typed.
      expect(() => composeNote(s, {
        text: 'x', reason: 'r', session: SESSION, notBefore: plusDays(365).toISOString(),
      }, VERSION, NOW)).toThrow(/could never be offered/);
      expect(pendingNotes(s, NOW)).toHaveLength(0);
    }));

  test('the refusal names the default it was judged against, so the fix is obvious', () =>
    withMailbox(s => {
      expect(() => composeNote(s, {
        text: 'x', reason: 'r', session: SESSION, notBefore: plusDays(20).toISOString(),
      }, VERSION, NOW)).toThrow(/defaulted to now plus the 14-day TTL/);
    }));

  test('a longer configured TTL makes the same notBefore legal — the check reads config', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.default_ttl_days', '30');
      const id = note(s, 'for later', { notBefore: plusDays(20).toISOString() });
      expect(noteView(s, id, NOW)?.state).toBe('queued');
    }));

  test('validateNote reports every problem at once rather than the first', () => {
    const problems = validateNote({ text: '', reason: '', session: '' }, NOW);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  test('the queue cap fails loudly rather than queueing silently past it', () => withMailbox(s => {
    writeConfig(s, 'mailbox.max_pending', '2');
    note(s, 'one'); note(s, 'two');
    expect(() => note(s, 'three')).toThrow(/at the limit of 2/);
    expect(pendingNotes(s, NOW)).toHaveLength(2);
  }));

  test('a supersede is allowed at the cap — correcting a queued note must stay possible', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.max_pending', '1');
      const first = note(s, 'stale advice', { seriesKey: 'migration-52' });
      const second = note(s, 'better advice', { seriesKey: 'migration-52' });
      expect(noteView(s, first, NOW)?.state).toBe('withdrawn');
      expect(noteView(s, second, NOW)?.state).toBe('queued');
      expect(pendingNotes(s, NOW)).toHaveLength(1);
    }));

  test('series dedupe replaces rather than piles up — the groundhog-day foreclosure', () =>
    withMailbox(s => {
      const first  = note(s, 'remember the migration', { seriesKey: 'migration' }),
            result = composeNote(s, { text: 'remember the migration', reason: 'again',
                                      session: 's1', seriesKey: 'migration' }, VERSION, NOW);
      expect(result.superseded).toBe(first);
      expect(pendingNotes(s, NOW).map(v => v.id)).toEqual([result.id]);
    }));

  test('a different series is untouched by a supersede', () => withMailbox(s => {
    const other = note(s, 'unrelated', { seriesKey: 'other' });
    note(s, 'a', { seriesKey: 'migration' });
    note(s, 'b', { seriesKey: 'migration' });
    expect(noteView(s, other, NOW)?.state).toBe('queued');
  }));

});

describe('ripeness', () => {

  test('a note for Tuesday is not ripe on Saturday, and is ripe on Tuesday', () => withMailbox(s => {
    note(s, 'for later', { notBefore: plusDays(3).toISOString() });
    expect(ripeNotes(s, NOW)).toHaveLength(0);
    expect(ripeNotes(s, plusDays(3))).toHaveLength(1);
  }));

  test('a note with no notBefore is ripe immediately', () => withMailbox(s => {
    note(s);
    expect(ripeNotes(s, NOW)).toHaveLength(1);
  }));

  test('an expired note is never ripe again — expiry is not a pause', () => withMailbox(s => {
    note(s);
    expect(ripeNotes(s, plusDays(15))).toHaveLength(0);
    expect(noteView(s, 1, plusDays(15))?.state).toBe('expired');
  }));

});

describe('the delivery discipline', () => {

  test('a wakeup turn is offered nothing, whatever is ripe — the founding rule', () =>
    withMailbox(s => {
      note(s);
      expect(ripeNotes(s, NOW)).toHaveLength(1);
      for (const turn of ['wakeup', 'notification', 'hook'] as const) {
        expect(offerRipeNotes(s, { turn, promptId: 'p-1', session: SESSION }, NOW)).toEqual([]);
      }
      // and nothing was recorded, so no later turn can point at a phantom offer
      expect(s.db.prepare("SELECT COUNT(*) n FROM note_events WHERE event = 'offered'")
              .get()?.['n']).toBe(0);
    }));

  test('a reply turn with no prompt identity is offered nothing', () => withMailbox(s => {
    note(s);
    expect(offerRipeNotes(s, { turn: 'reply', promptId: '', session: SESSION }, NOW)).toEqual([]);
  }));

  test('a reply turn with no session identity is offered nothing either', () => withMailbox(s => {
    note(s);
    // Half an identity is no identity: an offer nobody could ever redeem would leave the
    // model rendering words it then cannot report having rendered.
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW)).toEqual([]);
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-1', session: '' }, NOW)).toEqual([]);
    expect(s.db.prepare("SELECT COUNT(*) n FROM note_events WHERE event = 'offered'")
            .get()?.['n']).toBe(0);
  }));

  test('a reply turn is offered the ripe note, stamped reply against that prompt', () =>
    withMailbox(s => {
      const id      = note(s),
            offered = offerRipeNotes(s, { turn: 'reply', promptId: 'p-1', session: 's1' }, NOW);
      expect(offered.map(v => v.id)).toEqual([id]);
      const row = s.db.prepare(
        "SELECT turn, prompt_id FROM note_events WHERE event = 'offered'").get();
      expect(row).toEqual({ turn: 'reply', prompt_id: 'p-1' });
      expect(noteView(s, id, NOW)?.state).toBe('offered');
    }));

  test('surfacing succeeds only for the turn that was actually offered', () => withMailbox(s => {
    const id = note(s);
    replyTurn(s, 'p-1');
    expect(() => surface(s, id, 'p-2'))
      .toThrow(/was not offered on this turn/);
    expect(surface(s, id, 'p-1').state).toBe('surfaced');
  }));

  test('a note nobody offered cannot be surfaced at all', () => withMailbox(s => {
    const id = note(s);
    expect(() => surface(s, id, 'p-1'))
      .toThrow(/was not offered on this turn/);
    expect(noteView(s, id, NOW)?.state).toBe('queued');
  }));

  test('surfacing a note that does not exist is refused', () => withMailbox(s => {
    expect(() => surface(s, 999, 'p-1'))
      .toThrow(/does not exist/);
  }));

  test('a surfaced note cannot be surfaced twice', () => withMailbox(s => {
    const id = note(s);
    replyTurn(s, 'p-1');
    surface(s, id, 'p-1');
    expect(() => surface(s, id, 'p-1')).toThrow(/terminal/);
  }));

  test('an offer that lapsed cannot be redeemed later, even against its own prompt id', () =>
    withMailbox(s => {
      const id = note(s);
      replyTurn(s, 'p-1');
      // The next turn lapses p-1's offer as declined and, with the budget spent, makes no
      // new one — so `last_offer_prompt` still reads 'p-1' and, before the fix, still
      // answered "yes, that was your turn" to anyone who asked.
      writeConfig(s, 'mailbox.surface_budget', '0');
      replyTurn(s, 'p-2');
      expect(noteView(s, id, NOW)?.state).toBe('queued');
      expect(() => surface(s, id, 'p-1')).toThrow(/no offer outstanding/);
      expect(s.db.prepare("SELECT COUNT(*) n FROM note_events WHERE event = 'surfaced'")
              .get()?.['n']).toBe(0);
    }));

  test('an offer belongs to a session as well as a turn', () => withMailbox(s => {
    const id = note(s);
    replyTurn(s, 'p-1');
    // The turn id is right and observed by a hook; only the session differs, and that is
    // enough, because a prompt id alone is a token the model can read and quote back.
    hookTurn(s, 'p-1', NOW, 'other-session');
    expect(() => surfaceNote(s, id, { turn: 'reply', promptId: 'p-1', session: 'other-session' }, NOW))
      .toThrow(/was offered to session/);
    expect(() => surfaceNote(s, id, { turn: 'reply', promptId: 'p-1' }, NOW))
      .toThrow(/no session at all/);
  }));

  test('a turn only begin_turn recorded authorises nothing, however real the offer', () =>
    withMailbox(s => {
      const id = note(s);
      // A volunteered context row for exactly the turn the note was offered on. Every
      // other condition passes; this one is what a forged turn cannot buy.
      recordContext(s, { session: SESSION, promptId: 'p-1', turn: 'reply', source: 'tool' }, NOW);
      offerRipeNotes(s, { turn: 'reply', promptId: 'p-1', session: SESSION }, NOW);
      expect(() => surface(s, id, 'p-1')).toThrow(/no UserPromptSubmit hook ever observed/);
      expect(noteView(s, id, NOW)?.state).toBe('offered');
    }));

  test('the daily cap is rechecked at the claim, not only at the offer', () => withMailbox(s => {
    const id = note(s);
    replyTurn(s, 'p-1');
    // The cap moves between the offer and the report — a configure call, or another
    // session spending the window. The claim is refused rather than quietly overshooting.
    writeConfig(s, 'mailbox.daily_cap', '0');
    expect(() => surface(s, id, 'p-1')).toThrow(/rolling 24-hour cap/);
    expect(noteView(s, id, NOW)?.state).toBe('offered');
  }));

  test('there is no read state anywhere in the vocabulary', () => {
    expect(NOTE_STATES).not.toContain('read');
    expect(NOTE_EVENTS).not.toContain('read');
    expect(NOTE_STATES).toContain('surfaced');
  });

});

describe('budgets and caps', () => {

  test('one turn is offered at most surface_budget notes', () => withMailbox(s => {
    note(s, 'a'); note(s, 'b'); note(s, 'c');
    expect(replyTurn(s, 'p-1')).toHaveLength(1);
    writeConfig(s, 'mailbox.surface_budget', '2');
    expect(replyTurn(s, 'p-2')).toHaveLength(2);
  }));

  test('a surface_budget of zero holds everything without disabling composition', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.surface_budget', '0');
      note(s);
      expect(replyTurn(s, 'p-1')).toEqual([]);
      expect(pendingNotes(s, NOW)).toHaveLength(1);
    }));

  test('the daily cap bounds surfacing across turns, and never overshoots', () => withMailbox(s => {
    writeConfig(s, 'mailbox.daily_cap', '2');
    for (const text of ['a', 'b', 'c', 'd']) { note(s, text); }
    let surfaced = 0;
    for (const prompt of ['p-1', 'p-2', 'p-3', 'p-4']) {
      for (const offered of replyTurn(s, prompt)) {
        surface(s, offered.id, prompt);
        surfaced += 1;
      }
    }
    expect(surfaced).toBe(2);
    expect(surfacedRecently(s, NOW)).toBe(2);
  }));

  test('the cap window rolls: yesterday spends nothing of today', () => withMailbox(s => {
    writeConfig(s, 'mailbox.daily_cap', '1');
    note(s, 'a'); note(s, 'b');
    const first = replyTurn(s, 'p-1')[0];
    surface(s, first?.id ?? 0, 'p-1');
    expect(replyTurn(s, 'p-2')).toEqual([]);
    expect(replyTurn(s, 'p-3', plusDays(2))).toHaveLength(1);
  }));

  test('an unsurfaced offer lapses as declined on the next turn, and the count rises', () =>
    withMailbox(s => {
      const id = note(s);
      replyTurn(s, 'p-1');
      replyTurn(s, 'p-2');
      const events = s.db.prepare('SELECT event FROM note_events WHERE note_id = ? ORDER BY id')
                       .all(id).map(r => r['event']);
      expect(events).toEqual(['composed', 'offered', 'declined', 'offered']);
      expect(noteView(s, id, NOW)?.offerCount).toBe(2);
    }));

  test('after offer_cap declines a note expires, and never returns to the queue', () =>
    withMailbox(s => {
      const id = note(s);
      for (const prompt of ['p-1', 'p-2', 'p-3', 'p-4', 'p-5']) {
        replyTurn(s, prompt);
      }
      const view = noteView(s, id, NOW);
      expect(view?.state).toBe('expired');
      expect(view?.offerCount).toBe(3);
      expect(ripeNotes(s, NOW)).toHaveLength(0);
    }));

  test('the last offer the cap allows is still a real offer — surfaceable on that turn', () =>
    withMailbox(s => {
      const id = note(s);
      for (const prompt of ['p-1', 'p-2', 'p-3']) { replyTurn(s, prompt); }
      const view = noteView(s, id, NOW);
      expect(view?.offerCount).toBe(3);           // the whole cap, spent
      expect(view?.state).toBe('offered');        // and yet outstanding: this is the third chance
      expect(surface(s, id, 'p-3').state).toBe('surfaced');
    }));

  test('offer_cap 1 is a usable setting, not a mailbox that can never deliver', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.offer_cap', '1');
      const id = note(s);
      expect(replyTurn(s, 'p-1').map(v => v.id)).toEqual([id]);
      expect(noteView(s, id, NOW)?.state).toBe('offered');
      expect(surface(s, id, 'p-1').state).toBe('surfaced');
    }));

  test('at offer_cap 1 an unsurfaced note expires the moment its one offer lapses', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.offer_cap', '1');
      const id = note(s);
      replyTurn(s, 'p-1');
      replyTurn(s, 'p-2');
      expect(noteView(s, id, NOW)?.state).toBe('expired');
      const events = s.db.prepare('SELECT event FROM note_events WHERE note_id = ? ORDER BY id')
                       .all(id).map(r => r['event']);
      expect(events).toEqual(['composed', 'offered', 'declined', 'expired']);
    }));

  test('lapseStaleOffers leaves the current turn’s own offer alone', () => withMailbox(s => {
    const id = note(s);
    replyTurn(s, 'p-1');
    expect(lapseStaleOffers(s, 'p-1', NOW)).toBe(0);
    expect(noteView(s, id, NOW)?.state).toBe('offered');
  }));

});

describe('expiry and withdrawal', () => {

  test('the sweep materializes expiry, so the record says when a note died', () => withMailbox(s => {
    const id = note(s);
    expect(sweepExpired(s, plusDays(15))).toBe(1);
    const row = s.db.prepare(
      "SELECT ts_utc FROM note_events WHERE note_id = ? AND event = 'expired'").get(id);
    expect(row?.['ts_utc']).toBe(plusDays(15).toISOString());
    expect(sweepExpired(s, plusDays(16))).toBe(0);   // idempotent: terminal is terminal
  }));

  test('a withdrawal beats a later expiry — a recorded terminal event is the last word', () =>
    withMailbox(s => {
      const id = note(s);
      withdrawNote(s, id, {}, NOW);
      expect(noteView(s, id, plusDays(90))?.state).toBe('withdrawn');
    }));

  test('withdrawing reports the state it was in, and is terminal', () => withMailbox(s => {
    const id = note(s);
    expect(withdrawNote(s, id, { turn: 'reply', promptId: 'p-1' }, NOW).state).toBe('queued');
    expect(noteView(s, id, NOW)?.state).toBe('withdrawn');
    expect(() => withdrawNote(s, id, {}, NOW)).toThrow(/terminal/);
  }));

  test('withdrawing a note that does not exist is refused', () => withMailbox(s => {
    expect(() => withdrawNote(s, 42, {}, NOW)).toThrow(/does not exist/);
  }));

  test('a withdrawn note is never offered again', () => withMailbox(s => {
    withdrawNote(s, note(s), {}, NOW);
    expect(replyTurn(s, 'p-1')).toEqual([]);
  }));

});

describe('deriveNoteState', () => {

  const far = '2099-01-01T00:00:00.000Z',
        now = NOW.toISOString();

  test('a recorded terminal event wins over every derived death', () => {
    expect(deriveNoteState(
      { terminalEvent: 'withdrawn', lastEvent: 'withdrawn', offerCount: 9,
        expiresUtc: '2000-01-01T00:00:00.000Z' }, 3, now)).toBe('withdrawn');
  });

  test('a passed TTL expires a note that has no terminal event', () => {
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'composed', offerCount: 0,
        expiresUtc: '2000-01-01T00:00:00.000Z' }, 3, now)).toBe('expired');
  });

  test('reaching the offer cap expires a note that has no terminal event', () => {
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'declined', offerCount: 3, expiresUtc: far }, 3, now))
      .toBe('expired');
  });

  test('an outstanding offer is the transient offered state', () => {
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'offered', offerCount: 1, expiresUtc: far }, 3, now))
      .toBe('offered');
  });

  test('an outstanding offer outranks the offer cap — the last chance is still a chance', () => {
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'offered', offerCount: 3, expiresUtc: far }, 3, now))
      .toBe('offered');
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'offered', offerCount: 1, expiresUtc: far }, 1, now))
      .toBe('offered');
  });

  test('but a passed TTL still outranks even an outstanding offer', () => {
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'offered', offerCount: 1,
        expiresUtc: '2000-01-01T00:00:00.000Z' }, 3, now)).toBe('expired');
  });

  test('anything else is queued', () => {
    expect(deriveNoteState(
      { terminalEvent: null, lastEvent: 'declined', offerCount: 1, expiresUtc: far }, 3, now))
      .toBe('queued');
  });

});

describe('the messagebox seam', () => {

  test('a held note is not counted as ordinary unread user mail', () => withMailbox(s => {
    note(s);
    expect(unreadCounts(s, 's1', NOW).forUser).toBe(0);
  }));

  test('an ordinary user message still counts, so the exclusion is notes-only', () => withMailbox(s => {
    note(s);
    readMessages(s, { reader: 'model', session: 's1' }, { audience: 'user' }, NOW);
    s.db.prepare(`
      INSERT INTO messages (uuid, ts_utc, ts_local, tz, session, machine_id, audience, text, plugin_version)
      VALUES ('m-x','2026-08-28T00:00:00Z','9:14 am PDT','PDT','s1','m1','user','plain aside','0.2.1')`).run();
    expect(unreadCounts(s, 's1', NOW).forUser).toBe(1);
  }));

  test('a note is invisible to the unread user delivery but visible in the peek', () =>
    withMailbox(s => {
      note(s, 'held text');
      expect(readMessages(s, { reader: 'user' }, { audience: 'user' }, NOW)).toHaveLength(0);
      const peek = readMessages(s, { reader: 'user' }, { audience: 'user', ack: false }, NOW);
      expect(peek.map(r => r['text'])).toEqual(['held text']);
    }));

});

describe('rendering and the audit surface', () => {

  test('the provenance line names the note, when it was written, and why', () => withMailbox(s => {
    const view = noteView(s, note(s), NOW);
    const rendered = renderHeldNote(view!);
    expect(rendered).toContain('📬 Held note #1');
    expect(rendered).toContain('written ');
    expect(rendered).toContain('held until ');
    expect(rendered).toContain('the deploy window opens Tuesday');
    expect(rendered).toContain('run the reconcile step first');
  }));

  test('listNotes shows the notes that died, which is the point of an audit surface', () =>
    withMailbox(s => {
      withdrawNote(s, note(s, 'retracted'), {}, NOW);
      note(s, 'still waiting');
      expect(listNotes(s, {}, NOW).map(v => v.state).sort()).toEqual(['queued', 'withdrawn']);
      expect(listNotes(s, { state: 'withdrawn' }, NOW).map(v => v.text)).toEqual(['retracted']);
    }));

  test('listNotes honours its limit', () => withMailbox(s => {
    for (const text of ['a', 'b', 'c']) { note(s, text); }
    expect(listNotes(s, { limit: 2 }, NOW)).toHaveLength(2);
  }));

  test('a state filter reaches past the newest page — an audit door that says none must mean none', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.max_pending', '40');
      const ids = Array.from({ length: 30 }, (_, i) => note(s, `note ${String(i)}`));
      // The five OLDEST are the withdrawn ones, so a "newest few, then filter" listing
      // finds nothing at all — which is what it used to do.
      for (const id of ids.slice(0, 5)) { withdrawNote(s, id, {}, NOW); }
      const found = listNotes(s, { state: 'withdrawn', limit: 5 }, NOW);
      expect(found.map(v => v.id).sort((a, b) => a - b)).toEqual(ids.slice(0, 5));
      expect(listNotes(s, { state: 'queued', limit: 5 }, NOW)).toHaveLength(5);
    }));

  test('a state filter that genuinely matches nothing still returns nothing', () =>
    withMailbox(s => {
      note(s, 'a');
      expect(listNotes(s, { state: 'surfaced', limit: 5 }, NOW)).toEqual([]);
    }));

  test('formatNotes says so when there is nothing, rather than printing emptiness', () => {
    expect(formatNotes([])).toBe('no notes.');
  });

  test('formatNotes renders one line per note, carrying the state', () => withMailbox(s => {
    note(s, 'one');
    const text = formatNotes(listNotes(s, {}, NOW));
    expect(text.split('\n')).toHaveLength(1);
    expect(text).toContain('queued');
    expect(text).toContain('one');
  }));

});
