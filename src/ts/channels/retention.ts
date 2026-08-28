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

/**
 * Delete `entries` and `turn_context` rows whose `ts_utc` is older than now minus
 * `retention.days` days.
 *
 * Reads the horizon through the tolerant accessor, so an invalid stored value behaves
 * as the default — `0`, which disables pruning entirely and is why an unconfigured or
 * corrupted install can never lose a row here. `ts_utc` is ISO 8601 UTC, so the
 * comparison is a plain lexicographic one.
 *
 * @param store the open store to prune
 * @param now   injectable clock, so tests can pin the horizon
 * @returns how many rows were removed from each table
 *
 * @example
 *   writeConfig(store, 'retention.days', 30);
 *   pruneExpired(store)  // => { entries: 12, turnContext: 47 } — rows older than 30 days
 *
 * @see effectiveValue
 */
export function pruneExpired(store: Store, now: Date = new Date()): Pruned {

  const days = Number(effectiveValue(store, 'retention.days') ?? '0');

  if (days === 0) {
    return { entries: 0, turnContext: 0, messages: 0, messageReads: 0, notes: 0, noteEvents: 0 };
  }

  const horizon = new Date(now.getTime() - days * DAY_MS).toISOString();

  const entries     = store.db.prepare('DELETE FROM entries      WHERE ts_utc < ?').run(horizon),
        turnContext = store.db.prepare('DELETE FROM turn_context WHERE ts_utc < ?').run(horizon),
        // Receipts of doomed messages go first — the foreign key would otherwise
        // refuse the message delete. Orphanhood, not age, is the receipts' only
        // criterion: a receipt of a surviving message must survive, or the message
        // would be resurrected as unread.
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
