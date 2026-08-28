import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readMeta, readConfig } from '../channels/store.js';
import type { Store }    from '../channels/store.js';
import { recordEntry }   from '../channels/entries.js';
import { recordContext } from '../channels/context.js';
import { pruneExpired }  from '../channels/retention.js';

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
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0 });
    expect(counts(s)).toEqual({ entries: 4, context: 4 });
  }));

  test('prunes both tables past the horizon and keeps everything inside it', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 30);
    expect(pruneExpired(s, NOW)).toEqual({ entries: 2, turnContext: 2 });
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
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0 });
    expect(counts(s)).toEqual({ entries: 4, context: 4 });
  }));

  test('a second pass finds nothing left to prune', () => withStore(s => {
    seed(s);
    writeConfig(s, 'retention.days', 30);
    pruneExpired(s, NOW);
    expect(pruneExpired(s, NOW)).toEqual({ entries: 0, turnContext: 0 });
  }));

});
