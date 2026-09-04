import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readMeta, readConfig } from '../channels/store.js';
import type { Store }    from '../channels/store.js';
import { recordEntry, standingOf, register } from '../channels/entries.js';
import { recordContext } from '../channels/context.js';
import { pruneExpired }  from '../channels/retention.js';
import { postMessage, readMessages, unreadCounts } from '../channels/messages.js';
import { composeNote, listNotes } from '../channels/notes.js';

const VERSION = '0.2.1';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-retention-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

const NOW = new Date('2026-08-28T12:00:00Z');

/** A date `days` days before {@link NOW}, for synthesizing rows around the horizon. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function counts(s: Store): { entries: number; context: number } {
  return {
    entries : Number(s.db.prepare('SELECT COUNT(*) AS n FROM entries').get()?.['n'] ?? -1),
    context : Number(s.db.prepare('SELECT COUNT(*) AS n FROM turn_context').get()?.['n'] ?? -1),
  };
}

/** Rows straddling a 30-day horizon: two stale, two fresh, in each pruned table. */
function seed(s: Store): void {
  recordEntry(s, { channel: 'signature', text: 'ancient', session: 's1' }, VERSION, daysAgo(90));
  recordEntry(s, { channel: 'signature', text: 'stale',   session: 's1' }, VERSION, daysAgo(31));
  recordEntry(s, { channel: 'signature', text: 'recent',  session: 's1' }, VERSION, daysAgo(29));
  recordEntry(s, { channel: 'signature', text: 'today',   session: 's1' }, VERSION, NOW);
  recordContext(s, { session: 's1' }, daysAgo(90));
  recordContext(s, { session: 's1' }, daysAgo(31));
  recordContext(s, { session: 's1' }, daysAgo(29));
  recordContext(s, { session: 's1' }, NOW);
}

describe('pruneExpired', () => {

  test('the default — 0 — disables pruning entirely', () => withStore(s => {
    seed(s);
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0, messages: 0, messageReads: 0, notes: 0, noteEvents: 0 });
    expect(counts(s)).toEqual({ entries: 4, context: 4 });
  }));

  test('prunes both tables past the horizon and keeps everything inside it', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW))
      .toEqual({ entries: 2, turnContext: 2, messages: 0, messageReads: 0, notes: 0, noteEvents: 0 });
    expect(counts(s)).toEqual({ entries: 2, context: 2 });
    const texts = s.db.prepare('SELECT text FROM entries ORDER BY id').all().map(r => r['text']);
    expect(texts).toEqual(['recent', 'today']);
  }));

  test('meta and config are never touched by retention', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 1);
    writeConfig(s, 'gate.signature', false);
    pruneExpired(s, NOW);
    expect(readMeta(s, 'schema_version')).not.toBeNull();
    expect(readMeta(s, 'created_utc')).not.toBeNull();
    expect(readConfig(s, 'retention.days')).toBe('1');
    expect(readConfig(s, 'gate.signature')).toBe('false');
  }));

  test('a row exactly at the horizon survives — only strictly older rows are pruned', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'at-horizon', session: 's1' }, VERSION, daysAgo(30));
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW).entries).toBe(0);
    expect(counts(s).entries).toBe(1);
  }));

  test('an invalid stored horizon behaves as unset — nothing is pruned (D5)', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 'sometimes');
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0, messages: 0, messageReads: 0, notes: 0, noteEvents: 0 });
    expect(counts(s)).toEqual({ entries: 4, context: 4 });
  }));

  test('a second pass finds nothing left to prune', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 30);
    pruneExpired(s, NOW);
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0, messages: 0, messageReads: 0, notes: 0, noteEvents: 0 });
  }));

  test('messages ride the same horizon (#41): old rows pruned, fresh rows kept', () => withStore(s => {
    postMessage(s, { audience: 'record', text: 'ancient', session: 's1' }, VERSION, daysAgo(90));
    postMessage(s, { audience: 'record', text: 'today',   session: 's1' }, VERSION, NOW);
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW).messages).toBe(1);
    const texts = s.db.prepare('SELECT text FROM messages ORDER BY id').all().map(r => r['text']);
    expect(texts).toEqual(['today']);
  }));

  test('receipts are pruned only by orphanhood — never by their own age', () => withStore(s => {
    // An old message read recently, and a fresh message read long ago (synthetically):
    // pruning must remove exactly the receipts whose message went, and no others —
    // deleting a surviving message's receipt would resurrect it as unread.
    postMessage(s, { audience: 'self', text: 'old note',   session: 's1' }, VERSION, daysAgo(90));
    postMessage(s, { audience: 'self', text: 'fresh note', session: 's1' }, VERSION, NOW);
    readMessages(s, { reader: 'model', session: 's1' }, { audience: 'self' }, daysAgo(60));
    expect(unreadCounts(s, 's1', NOW).forModel).toBe(0);

    writeConfig(s, 'retention.days', 30);
    const pruned = pruneExpired(s, NOW);
    expect(pruned.messages).toBe(1);
    expect(pruned.messageReads).toBe(1);

    // The fresh note's receipt survived, so it does not come back as unread.
    expect(unreadCounts(s, 's1', NOW).forModel).toBe(0);
    const orphans = s.db.prepare(
      'SELECT COUNT(*) AS n FROM message_reads WHERE message_id NOT IN (SELECT id FROM messages)').get();
    expect(Number(orphans?.['n'])).toBe(0);
  }));

  test('held notes and their ledger prune by orphanhood with their message (#43)', () => withStore(s => {
    writeConfig(s, 'mailbox.enabled', 'true');
    composeNote(s, { text: 'ancient', reason: 'r', session: 's1' }, VERSION, daysAgo(90));
    composeNote(s, { text: 'today',   reason: 'r', session: 's1' }, VERSION, NOW);
    writeConfig(s, 'retention.days', 30);

    const pruned = pruneExpired(s, NOW);
    expect(pruned.messages).toBe(1);
    expect(pruned.notes).toBe(1);
    expect(pruned.noteEvents).toBe(1);

    // Exactly the survivor is left, and nothing dangles: an orphaned note or ledger row
    // would be a state the derivation could not read at all.
    expect(listNotes(s, {}, NOW).map(n => n.text)).toEqual(['today']);
    const dangling = s.db.prepare(
      'SELECT COUNT(*) AS n FROM note_events WHERE note_id NOT IN (SELECT id FROM notes)').get();
    expect(Number(dangling?.['n'])).toBe(0);
  }));

  test('expiry is not retention: an expired message survives pruning inside the horizon', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'expired but recent', session: 's1',
                     expiresUtc: daysAgo(1).toISOString() }, VERSION, daysAgo(2));
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW).messages).toBe(0);
    expect(s.db.prepare('SELECT COUNT(*) n FROM messages').get()?.['n']).toBe(1);
  }));

});

/** The current `PRAGMA foreign_keys` setting on a store's own connection. */
function foreignKeys(s: Store): number {
  return Number(s.db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys'] ?? -1);
}

/**
 * A retraction straddling a 30-day horizon: the struck row is `agedDays` old, the strike
 * that struck it `strikeDays` old.
 *
 * @returns the two row ids, original first
 */
function straddle(s: Store, agedDays: number, strikeDays: number): { target: number; strike: number } {
  const target = recordEntry(
    s, { channel: 'signature', text: 'the wrong reading', session: 's1' }, VERSION, daysAgo(agedDays)).id;
  const strike = recordEntry(s, {
    channel      : 'divergence',
    text         : 'that reading was wrong',
    session      : 's1',
    correctsId   : target,
    correctsKind : 'retracts',
    verbatim     : 'the wrong reading',
  }, VERSION, daysAgo(strikeDays)).id;
  return { target, strike };
}

/**
 * Corrections outliving what they correct.
 *
 * A strike is by nature newer than its target, so `entries.corrects_id` — a self-FK with
 * no `ON DELETE` clause — guarantees that the first correction to straddle the horizon
 * makes the whole prune fail. `entries` is the first statement, so the failure took
 * `turn_context`, `messages`, and the notes down with it: a user with `retention.days 30`
 * kept everything, forever, and was told nothing.
 */
describe('pruneExpired — a correction may outlive the row it corrects', () => {

  test('the straddling case: the original is pruned and the strike survives it', () => withStore(s => {

    const { target, strike } = straddle(s, 90, 2);
    writeConfig(s, 'retention.days', 30);

    expect(pruneExpired(s, NOW).entries).toBe(1);

    const left = s.db.prepare('SELECT id, corrects_id FROM entries').all();
    expect(left.map(row => Number(row['id']))).toEqual([strike]);

    // The link is kept, now dangling: the row still records that it *was* a correction
    // and of which id. "The original was pruned" is what the horizon means, and nulling
    // the link would erase the correction edge instead of the claim.
    expect(Number(left[0]?.['corrects_id'])).toBe(target);

    // And the survivor reads as an ordinary live row with its own standing.
    expect(standingOf(s, [strike])).toEqual([{ id: strike, status: 'stands', by: null }]);

  }));

  test('the straddling failure took every other table with it — it no longer does', () => withStore(s => {

    straddle(s, 90, 2);
    recordContext(s, { session: 's1' }, daysAgo(90));
    postMessage(s, { audience: 'record', text: 'ancient', session: 's1' }, VERSION, daysAgo(90));
    writeConfig(s, 'retention.days', 30);

    const pruned = pruneExpired(s, NOW);
    expect(pruned).toMatchObject({ entries: 1, turnContext: 1, messages: 1 });

  }));

  test('both sides inside the horizon: the whole correction goes', () => withStore(s => {
    straddle(s, 90, 60);
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW).entries).toBe(2);
    expect(counts(s).entries).toBe(0);
  }));

  test('both sides outside the horizon: the whole correction stays', () => withStore(s => {
    straddle(s, 5, 2);
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW).entries).toBe(0);
    expect(counts(s).entries).toBe(2);
  }));

  test('the register presents a survivor whose original was pruned as originalless', () => withStore(s => {

    const { strike } = straddle(s, 90, 2);
    writeConfig(s, 'retention.days', 30);
    pruneExpired(s, NOW);

    const rows = register(s, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.original).toBeNull();
    expect(rows[0]?.replacement.id).toBe(strike);
    // The withdrawn words were quoted onto the strike, so they outlive the row too.
    expect(rows[0]?.verbatim).toBe('the wrong reading');

  }));

  test('a message reply outlives the message it replies to (messages.reply_to)', () => withStore(s => {

    const parent = postMessage(s, { audience: 'record', text: 'ancient', session: 's1' },
                               VERSION, daysAgo(90)).id;
    postMessage(s, { audience: 'record', text: 'later thought', session: 's1', replyTo: parent },
                VERSION, daysAgo(2));
    writeConfig(s, 'retention.days', 30);

    expect(pruneExpired(s, NOW).messages).toBe(1);

    const left = s.db.prepare('SELECT text, reply_to FROM messages').all();
    expect(left.map(row => row['text'])).toEqual(['later thought']);
    expect(Number(left[0]?.['reply_to'])).toBe(parent);

  }));

  test('foreign key enforcement is restored, and really enforced, after a prune', () => withStore(s => {

    expect(foreignKeys(s)).toBe(1);
    straddle(s, 90, 2);
    writeConfig(s, 'retention.days', 30);
    pruneExpired(s, NOW);

    expect(foreignKeys(s)).toBe(1);

    // The pragma readout is not the claim; enforcement is. A receipt naming no message
    // must still be refused the moment pruning has finished.
    expect(() => s.db.prepare(
      'INSERT INTO message_reads (message_id, ts_utc, reader) VALUES (?,?,?)')
      .run(999_999, NOW.toISOString(), 'model')).toThrow(/FOREIGN KEY/);

  }));

  test('a connection that had foreign keys off gets them back off', () => withStore(s => {

    // The setting is restored to what was *found*, not to what openStore normally leaves:
    // a caller pruning a connection it configured itself keeps its own configuration.
    s.db.exec('PRAGMA foreign_keys = OFF');
    straddle(s, 90, 2);
    writeConfig(s, 'retention.days', 30);
    pruneExpired(s, NOW);
    expect(foreignKeys(s)).toBe(0);

  }));

  test('a failed pass prunes nothing and still restores enforcement', () => withStore(s => {

    straddle(s, 90, 2);
    recordContext(s, { session: 's1' }, daysAgo(90));
    writeConfig(s, 'retention.days', 30);

    // `turn_context` is pruned second, so this aborts mid-transaction with `entries`
    // already deleted — exactly the state the rollback exists for.
    s.db.exec(
      `CREATE TRIGGER prune_boom BEFORE DELETE ON turn_context
         BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    expect(() => pruneExpired(s, NOW)).toThrow();
    s.db.exec('DROP TRIGGER prune_boom');

    expect(counts(s)).toEqual({ entries: 2, context: 1 });
    expect(foreignKeys(s)).toBe(1);

  }));

});
