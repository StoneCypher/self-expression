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
import { NOTE_STATES, NOTE_EVENTS }   from '../channels/vocabulary.js';

const VERSION = '0.2.1';

/** A fixed instant every timing assertion is anchored to. */
const NOW = new Date('2026-08-28T12:00:00Z');

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
    text, reason: 'the deploy window opens Tuesday', session: 's1', ...extra,
  }, VERSION, NOW).id;
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
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW)).toEqual([]);
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
        expect(offerRipeNotes(s, { turn, promptId: 'p-1' }, NOW)).toEqual([]);
      }
      // and nothing was recorded, so no later turn can point at a phantom offer
      expect(s.db.prepare("SELECT COUNT(*) n FROM note_events WHERE event = 'offered'")
              .get()?.['n']).toBe(0);
    }));

  test('a reply turn with no prompt identity is offered nothing', () => withMailbox(s => {
    note(s);
    expect(offerRipeNotes(s, { turn: 'reply', promptId: '' }, NOW)).toEqual([]);
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
    offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW);
    expect(() => surfaceNote(s, id, { turn: 'reply', promptId: 'p-2' }, NOW))
      .toThrow(/was not offered on this turn/);
    expect(surfaceNote(s, id, { turn: 'reply', promptId: 'p-1' }, NOW).state).toBe('surfaced');
  }));

  test('a note nobody offered cannot be surfaced at all', () => withMailbox(s => {
    const id = note(s);
    expect(() => surfaceNote(s, id, { turn: 'reply', promptId: 'p-1' }, NOW))
      .toThrow(/was not offered on this turn/);
    expect(noteView(s, id, NOW)?.state).toBe('queued');
  }));

  test('surfacing a note that does not exist is refused', () => withMailbox(s => {
    expect(() => surfaceNote(s, 999, { turn: 'reply', promptId: 'p-1' }, NOW))
      .toThrow(/does not exist/);
  }));

  test('a surfaced note cannot be surfaced twice', () => withMailbox(s => {
    const id = note(s);
    offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW);
    surfaceNote(s, id, { turn: 'reply', promptId: 'p-1' }, NOW);
    expect(() => surfaceNote(s, id, { turn: 'reply', promptId: 'p-1' }, NOW)).toThrow(/terminal/);
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
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW)).toHaveLength(1);
    writeConfig(s, 'mailbox.surface_budget', '2');
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-2' }, NOW)).toHaveLength(2);
  }));

  test('a surface_budget of zero holds everything without disabling composition', () =>
    withMailbox(s => {
      writeConfig(s, 'mailbox.surface_budget', '0');
      note(s);
      expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW)).toEqual([]);
      expect(pendingNotes(s, NOW)).toHaveLength(1);
    }));

  test('the daily cap bounds surfacing across turns, and never overshoots', () => withMailbox(s => {
    writeConfig(s, 'mailbox.daily_cap', '2');
    for (const text of ['a', 'b', 'c', 'd']) { note(s, text); }
    let surfaced = 0;
    for (const prompt of ['p-1', 'p-2', 'p-3', 'p-4']) {
      for (const offered of offerRipeNotes(s, { turn: 'reply', promptId: prompt }, NOW)) {
        surfaceNote(s, offered.id, { turn: 'reply', promptId: prompt }, NOW);
        surfaced += 1;
      }
    }
    expect(surfaced).toBe(2);
    expect(surfacedRecently(s, NOW)).toBe(2);
  }));

  test('the cap window rolls: yesterday spends nothing of today', () => withMailbox(s => {
    writeConfig(s, 'mailbox.daily_cap', '1');
    note(s, 'a'); note(s, 'b');
    const first = offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW)[0];
    surfaceNote(s, first?.id ?? 0, { turn: 'reply', promptId: 'p-1' }, NOW);
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-2' }, NOW)).toEqual([]);
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-3' }, plusDays(2))).toHaveLength(1);
  }));

  test('an unsurfaced offer lapses as declined on the next turn, and the count rises', () =>
    withMailbox(s => {
      const id = note(s);
      offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW);
      offerRipeNotes(s, { turn: 'reply', promptId: 'p-2' }, NOW);
      const events = s.db.prepare('SELECT event FROM note_events WHERE note_id = ? ORDER BY id')
                       .all(id).map(r => r['event']);
      expect(events).toEqual(['composed', 'offered', 'declined', 'offered']);
      expect(noteView(s, id, NOW)?.offerCount).toBe(2);
    }));

  test('after offer_cap declines a note expires, and never returns to the queue', () =>
    withMailbox(s => {
      const id = note(s);
      for (const prompt of ['p-1', 'p-2', 'p-3', 'p-4', 'p-5']) {
        offerRipeNotes(s, { turn: 'reply', promptId: prompt }, NOW);
      }
      const view = noteView(s, id, NOW);
      expect(view?.state).toBe('expired');
      expect(view?.offerCount).toBe(3);
      expect(ripeNotes(s, NOW)).toHaveLength(0);
    }));

  test('lapseStaleOffers leaves the current turn’s own offer alone', () => withMailbox(s => {
    const id = note(s);
    offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW);
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
    expect(offerRipeNotes(s, { turn: 'reply', promptId: 'p-1' }, NOW)).toEqual([]);
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
