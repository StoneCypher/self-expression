/**
 * Startup retention: prune rows older than the configured horizon.
 *
 * `retention.days` prunes; it does not archive (issue #30, D6) — an archive would be a
 * second copy of precisely the data the user asked to have a horizon on. Pruning runs
 * at server startup rather than on the write path, so the cost lands once per process
 * and never interleaves deletion with the gates' reads; a horizon measured in days
 * needs no better resolution than "each session start".
 *
 * Both `entries` and `turn_context` are pruned on the same horizon: `turn_context`
 * carries the same path-shaped context the privacy keys guard, so trimming entries
 * while keeping context rows forever would be a privacy hole shaped exactly like the
 * one write-time redaction closes. The messagebox tables (#41) ride the same horizon:
 * `messages` prunes by age, and `message_reads` prunes **only by orphanhood** — a
 * receipt whose message survived must survive too, because deleting it would
 * resurrect the message as unread. Message expiry (`expires_utc`) is not retention:
 * it only stops delivery, and only this horizon ever deletes. The held-note tables
 * (#43) hang off `messages` and prune by orphanhood on the same terms. `meta` and
 * `config` are never touched.
 *
 * Pruning runs with foreign keys suspended, because a correction is always newer than
 * what it corrects and must be allowed to outlive it. {@link pruneExpired} carries the
 * full reasoning.
 *
 * @see ./config.js
 * @see ./store.js
 */

import { effectiveValue } from './config.js';
import type { Store }     from './store.js';

/** How many rows one pruning pass removed from each table. */
export interface Pruned {
  readonly entries      : number;
  readonly turnContext  : number;
  readonly messages     : number;
  /** Receipts removed because their message was pruned — never by their own age. */
  readonly messageReads : number;
  /** Held-note sidecars removed because their message was pruned (#43). */
  readonly notes        : number;
  /** Note ledger rows removed because their note was pruned — never by their own age. */
  readonly noteEvents   : number;
}

/** Milliseconds in one day, for the horizon arithmetic. */
const DAY_MS = 86_400_000;

/** What a disabled — or already-clean — pass reports. */
const NOTHING_PRUNED: Pruned = Object.freeze({
  entries: 0, turnContext: 0, messages: 0, messageReads: 0, notes: 0, noteEvents: 0,
});

/**
 * Whether foreign-key enforcement is currently on for this connection.
 *
 * Read rather than assumed, so {@link pruneExpired} restores the state it actually found
 * instead of the state {@link openStore} normally leaves — a caller pruning a connection
 * it opened itself must get its own setting back, not ours.
 *
 * @example
 *   foreignKeysOn(store)  // => true, on any store openStore produced
 */
function foreignKeysOn(store: Store): boolean {
  const row = store.db.prepare('PRAGMA foreign_keys').get();
  return Number(row?.['foreign_keys'] ?? 0) === 1;
}

/**
 * The deletes themselves, in the one order that leaves nothing orphaned.
 *
 * Split out from {@link pruneExpired} so the pragma and transaction handling around it
 * reads as the single thing it is. Ordering still matters even with foreign keys off:
 * each child delete names its doomed parents by a subquery against rows that must still
 * be present when it runs.
 *
 * @param horizon ISO 8601 UTC instant; rows strictly older than this go
 * @returns how many rows each statement removed
 */
function deleteOlderThan(store: Store, horizon: string): Pruned {

  const entries     = store.db.prepare('DELETE FROM entries      WHERE ts_utc < ?').run(horizon),
        turnContext = store.db.prepare('DELETE FROM turn_context WHERE ts_utc < ?').run(horizon),
        // Receipts of doomed messages go first, and must: the statement names its
        // parents through `SELECT id FROM messages`, so the messages have to still be
        // there. Orphanhood, not age, is the receipts' only criterion — a receipt of a
        // surviving message must survive, or the message would be resurrected as unread.
        reads       = store.db.prepare(
          'DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE ts_utc < ?)')
          .run(horizon),
        // Held notes (#43) hang off `messages` the same way, two links deep: the ledger
        // references the note, the note references the message. Both go by orphanhood,
        // innermost first, for exactly the receipts' reason — and a note whose message
        // is pruned is gone as a matter of the horizon, never of the note ladder, which
        // only ever ends a note by expiry, withdrawal, or surfacing.
        noteEvents  = store.db.prepare(`
          DELETE FROM note_events WHERE note_id IN (
            SELECT n.id FROM notes n JOIN messages m ON m.id = n.message_id WHERE m.ts_utc < ?)`)
          .run(horizon),
        notes       = store.db.prepare(
          'DELETE FROM notes WHERE message_id IN (SELECT id FROM messages WHERE ts_utc < ?)')
          .run(horizon),
        messages    = store.db.prepare('DELETE FROM messages     WHERE ts_utc < ?').run(horizon);

  return {
    entries      : Number(entries.changes),
    turnContext  : Number(turnContext.changes),
    messages     : Number(messages.changes),
    messageReads : Number(reads.changes),
    notes        : Number(notes.changes),
    noteEvents   : Number(noteEvents.changes),
  };

}

/**
 * Delete `entries` and `turn_context` rows whose `ts_utc` is older than now minus
 * `retention.days` days.
 *
 * Reads the horizon through the tolerant accessor, so an invalid stored value behaves
 * as the default — `0`, which disables pruning entirely and is why an unconfigured or
 * corrupted install can never lose a row here. `ts_utc` is ISO 8601 UTC, so the
 * comparison is a plain lexicographic one.
 *
 * **Foreign keys are suspended for the duration, deliberately.** `entries.corrects_id`
 * is a self-reference, and a strike is *by nature* newer than what it strikes: the first
 * time a correction straddles the horizon — target outside, strike inside — an enforced
 * `DELETE FROM entries` fails with `FOREIGN KEY constraint failed`, and because `entries`
 * is the first statement, nothing else gets pruned either. A `retention.days` of 30 then
 * keeps everything forever, silently, because the caller logs the failure and carries on.
 * The same shape exists on `messages.reply_to`.
 *
 * What the surviving strike keeps is its `corrects_id`, now dangling. That is the answer
 * this design wants, not a casualty of it: the row still records *that* it was a
 * correction and of which id, and "the original is no longer here" is exactly what the
 * horizon means. Nulling the link instead would erase the correction edge — the thing #16
 * exists to preserve — and `ON DELETE SET NULL` would additionally be a write onto a row,
 * which this table does not do. Read paths tolerate the dangle: {@link standingOf}
 * computes the survivor's own standing unchanged, {@link register} presents a pruned
 * target as `original: null`, and the public export's target-uuid subquery yields `null`.
 *
 * `PRAGMA foreign_keys` is a no-op inside a transaction, so the order is fixed: read the
 * current setting, turn enforcement off, run the whole prune as one transaction, and
 * restore the setting in a `finally` — including when the prune throws, so a failed pass
 * can never leave the connection unguarded for everything that follows it.
 *
 * @param store the open store to prune
 * @param now   injectable clock, so tests can pin the horizon
 * @returns how many rows were removed from each table
 *
 * @example
 *   writeConfig(store, 'retention.days', 30);
 *   pruneExpired(store)  // => { entries: 12, turnContext: 47, … } — rows older than 30 days
 *
 * @example
 *   // A retraction straddling the horizon: the original goes, the strike stays.
 *   pruneExpired(store).entries        // => 1
 *   standingOf(store, [strikeId])      // => [{ id: 214, status: 'stands', by: null }]
 *
 * @throws {Error} If a delete fails; the transaction rolls back, so a failed pass prunes
 *                 nothing rather than half of a horizon.
 *
 * @see effectiveValue
 * @see deleteOlderThan
 */
export function pruneExpired(store: Store, now: Date = new Date()): Pruned {

  const days = Number(effectiveValue(store, 'retention.days') ?? '0');

  if (days === 0) { return NOTHING_PRUNED; }

  const horizon  = new Date(now.getTime() - days * DAY_MS).toISOString(),
        restore  = foreignKeysOn(store);

  store.db.exec('PRAGMA foreign_keys = OFF');

  try {

    store.db.exec('BEGIN');

    try {
      const pruned = deleteOlderThan(store, horizon);
      store.db.exec('COMMIT');
      return pruned;
    } catch (problem) {
      store.db.exec('ROLLBACK');
      throw problem;
    }

  } finally {
    store.db.exec(restore ? 'PRAGMA foreign_keys = ON' : 'PRAGMA foreign_keys = OFF');
  }

}
