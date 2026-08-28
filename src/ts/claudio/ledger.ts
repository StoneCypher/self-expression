/**
 * Strike ledger lifecycle and queries.
 *
 * Its own SQLite file beside the expression log (never inside it), opened with the
 * same create-if-missing discipline as `channels/store.ts`. The ledger is both the
 * audit record and the rate limiter's memory: the gate's per-hour budget and
 * minimum-gap rules are answered from `playedSince`, so enforcement is server-side
 * state, never model politeness.
 *
 * @see ./schema.js
 * @see ./gate.js
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync }    from 'node:fs';
import { dirname }      from 'node:path';
import { randomUUID }   from 'node:crypto';
import { ALL_AUDIO_DDL, AUDIO_SCHEMA_VERSION } from './schema.js';
import type { Leitmotif, StrikeKind }          from './vocabulary.js';
import { audioDbPath } from './paths.js';
import { stamp }       from '../channels/time.js';

/** An open strike ledger. */
export interface AudioLedger {
  readonly db   : DatabaseSync;
  /** Absolute path to the ledger database file. */
  readonly path : string;
}

/** What one recorded strike attempt carries. */
export interface StrikeRecord {
  readonly kind            : StrikeKind;
  /** The meaning struck; `null` for `say`. */
  readonly leitmotif       : Leitmotif | null;
  /** The volume the caller asked for; `null` when they took the default. */
  readonly requestedVolume : number | null;
  /** The volume actually used after the ceiling clamp; 0 on a refusal. */
  readonly playedVolume    : number;
  /** The effective ceiling in force at the moment of the attempt. */
  readonly ceiling         : number;
  /** Played audio length in milliseconds; `null` when nothing was parsed. */
  readonly durationMs      : number | null;
  readonly outcome         : 'played' | 'refused' | 'error';
  /** The refusal reason or error text; `null` on success. */
  readonly detail          : string | null;
  /** `say` only: the spoken text. Local free text under the #31 rule — never aggregated. */
  readonly text            : string | null;
  /** Which plugin release wrote the row. */
  readonly pluginVersion   : string;
}

/** A written row's identity, for the tool reply. */
export interface WrittenStrike {
  readonly id   : number;
  readonly uuid : string;
}

/** One row of the rate limiter's recent-history view. */
export interface RecentStrike {
  readonly utc       : string;
  readonly kind      : StrikeKind;
  readonly leitmotif : string | null;
}

/**
 * Open (creating if necessary) the strike ledger, applying the schema idempotently.
 *
 * @param path - ledger file to open; defaults to the resolved data directory
 *
 * @example
 *   const ledger = openLedger('/tmp/x/audio.sqlite3');
 *   recordStrike(ledger, { ... });
 *   closeLedger(ledger);
 *
 * @throws {Error} If the directory cannot be created or the file cannot be opened —
 *                 loud on purpose: a facility that plays sounds it cannot ledger
 *                 would be exactly the unauditable noise the design forbids.
 */
export function openLedger(path: string = audioDbPath()): AudioLedger {

  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  for (const statement of ALL_AUDIO_DDL) { db.exec(statement); }

  db.prepare(
    'INSERT INTO meta (key, value, updated_utc) VALUES (?,?,?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc'
  ).run('schema_version', String(AUDIO_SCHEMA_VERSION), stamp().utc);

  return { db, path };

}

/**
 * Append one strike attempt to the ledger.
 *
 * @returns the new row's id and uuid, for the tool reply
 *
 * @example
 *   recordStrike(ledger, {
 *     kind: 'strike', leitmotif: 'spark', requestedVolume: null, playedVolume: 25,
 *     ceiling: 50, durationMs: 800, outcome: 'played', detail: null, text: null,
 *     pluginVersion: '0.2.1',
 *   })
 *   // => { id: 1, uuid: '9b2f...' }
 */
export function recordStrike(
  ledger : AudioLedger,
  record : StrikeRecord,
  when   : Date = new Date(),
): WrittenStrike {

  const uuid = randomUUID(),
        at   = stamp(when);

  const result = ledger.db.prepare(
    'INSERT INTO strikes (uuid, struck_utc, local, tz, kind, leitmotif, requested_volume, ' +
    'played_volume, ceiling, duration_ms, outcome, detail, text, plugin_version) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    uuid, at.utc, at.local, at.tz, record.kind, record.leitmotif,
    record.requestedVolume, record.playedVolume, record.ceiling, record.durationMs,
    record.outcome, record.detail, record.text, record.pluginVersion,
  );

  return { id: Number(result.lastInsertRowid), uuid };

}

/**
 * Every strike that actually *played* at or after `sinceUtc`, oldest first — the
 * rate limiter's working set. Refused and errored rows are audit trail, not noise
 * that happened, so they never count against a budget.
 *
 * @param sinceUtc - ISO 8601 UTC lower bound, inclusive
 *
 * @example
 *   playedSince(ledger, '2026-08-28T09:00:00.000Z')
 *   // => [{ utc: '2026-08-28T09:12:00.000Z', kind: 'strike', leitmotif: 'spark' }]
 */
export function playedSince(ledger: AudioLedger, sinceUtc: string): RecentStrike[] {

  const rows = ledger.db.prepare(
    "SELECT struck_utc, kind, leitmotif FROM strikes " +
    "WHERE outcome = 'played' AND struck_utc >= ? ORDER BY struck_utc ASC"
  ).all(sinceUtc);

  return rows.map(row => ({
    utc       : String(row['struck_utc']),
    kind      : String(row['kind']) as StrikeKind,
    leitmotif : row['leitmotif'] === null ? null : String(row['leitmotif']),
  }));

}

/**
 * Close the ledger. Safe to call on an already-closed store.
 *
 * @example
 *   closeLedger(ledger);
 */
export function closeLedger(ledger: AudioLedger): void {
  try { ledger.db.close(); } catch { /* already closed */ }
}
