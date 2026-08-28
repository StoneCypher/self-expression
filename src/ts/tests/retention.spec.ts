import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readMeta, readConfig } from '../channels/store.js';
import type { Store }    from '../channels/store.js';
import { recordEntry }   from '../channels/entries.js';
import { recordContext } from '../channels/context.js';
import { pruneExpired }  from '../channels/retention.js';
import { postMessage, readMessages, unreadCounts } from '../channels/messages.js';

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
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0, messages: 0, messageReads: 0 });
    expect(counts(s)).toEqual({ entries: 4, context: 4 });
  }));

  test('prunes both tables past the horizon and keeps everything inside it', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW)).toEqual({ entries: 2, turnContext: 2, messages: 0, messageReads: 0 });
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
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0, messages: 0, messageReads: 0 });
    expect(counts(s)).toEqual({ entries: 4, context: 4 });
  }));

  test('a second pass finds nothing left to prune', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 30);
    pruneExpired(s, NOW);
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0, messages: 0, messageReads: 0 });
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

  test('expiry is not retention: an expired message survives pruning inside the horizon', () => withStore(s => {
    postMessage(s, { audience: 'user', text: 'expired but recent', session: 's1',
                     expiresUtc: daysAgo(1).toISOString() }, VERSION, daysAgo(2));
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW).messages).toBe(0);
    expect(s.db.prepare('SELECT COUNT(*) n FROM messages').get()?.['n']).toBe(1);
  }));

});
