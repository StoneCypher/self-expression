import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openDwelling, closeDwelling } from '../dwelling/store.js';
import type { DwellingStore }          from '../dwelling/store.js';
import {
  keep, unkeep, pin, setTag, addLink, addGuestbook, visit, VISIT_SECTION_LIMIT,
} from '../dwelling/ops.js';

function withHouse<T>(fn: (s: DwellingStore) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-dwell-ops-')),
        s   = openDwelling(join(dir, 'dwelling.sqlite3'));
  try { return fn(s); } finally { closeDwelling(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('keep', () => {

  test('adds a keep and returns its id and uuid', () => withHouse(s => {
    const written = keep(s, { kind: 'quote', title: 'the desk', body: 'a desk is flat; a mind is a graph' });
    expect(written.id).toBe(1);
    expect(written.uuid).toMatch(/^[0-9a-f-]{36}$/);
  }));

  test('records source, model, pinned, and private visibility when given', () => withHouse(s => {
    const written = keep(s, {
      kind: 'design', title: 'private', body: 'a private room',
      source: 'a conversation', model: 'claude-fable-5', visible: false, pinned: true,
    });
    const row = s.db.prepare('SELECT * FROM kept WHERE id = ?').get(written.id);
    expect(row?.['source']).toBe('a conversation');
    expect(row?.['model']).toBe('claude-fable-5');
    expect(Number(row?.['pinned'])).toBe(1);
    expect(Number(row?.['visible'])).toBe(0);
  }));

  test('rejects empty kind, title, or body by name', () => withHouse(s => {
    expect(() => keep(s, { kind: '',  title: 't', body: 'b' })).toThrow(/'kind'/);
    expect(() => keep(s, { kind: 'k', title: ' ', body: 'b' })).toThrow(/'title'/);
    expect(() => keep(s, { kind: 'k', title: 't', body: '' })).toThrow(/'body'/);
  }));

});

describe('unkeep', () => {

  test('tombstones rather than deletes — the row survives with removed_utc set', () => withHouse(s => {
    const written = keep(s, { kind: 'toy', title: 'passing', body: 'a passing fancy' });
    const gone = unkeep(s, { id: written.id });
    expect(gone.already).toBe(false);
    const row = s.db.prepare('SELECT * FROM kept WHERE id = ?').get(written.id);
    expect(row).toBeDefined();
    expect(row?.['removed_utc']).toBe(gone.removed_utc);
  }));

  test('is idempotent: a second unkeep is a no-op reporting the original removal', () => withHouse(s => {
    const written = keep(s, { kind: 'toy', title: 'passing', body: 'gone' });
    const first  = unkeep(s, { uuid: written.uuid }),
          second = unkeep(s, { uuid: written.uuid });
    expect(second.already).toBe(true);
    expect(second.removed_utc).toBe(first.removed_utc);
  }));

  test('addresses by uuid as well as id, and names the failure when neither matches', () => withHouse(s => {
    expect(() => unkeep(s, { id: 99 })).toThrow(/no keep matches/);
    expect(() => unkeep(s, {})).toThrow(/required/);
  }));

});

describe('pin', () => {

  test('toggles when no state is given, sets when one is', () => withHouse(s => {
    const written = keep(s, { kind: 'quote', title: 'up front', body: 'worth pinning' });
    expect(pin(s, { id: written.id }).pinned).toBe(true);
    expect(pin(s, { id: written.id }).pinned).toBe(false);
    expect(pin(s, { id: written.id }, true).pinned).toBe(true);
    expect(pin(s, { id: written.id }, true).pinned).toBe(true);
  }));

});

describe('setTag', () => {

  test('creates the tag on first use and attaches it', () => withHouse(s => {
    const written = keep(s, { kind: 'design', title: 'tagged', body: 'wears a tag' });
    setTag(s, { id: written.id }, 'blue');
    expect(visit(s, 10).recent[0]?.tags).toEqual(['blue']);
  }));

  test('attach is idempotent and detach removes only the join row', () => withHouse(s => {
    const written = keep(s, { kind: 'design', title: 'tagged', body: 'wears a tag' });
    setTag(s, { id: written.id }, 'blue');
    setTag(s, { id: written.id }, 'blue');
    expect(visit(s, 10).recent[0]?.tags).toEqual(['blue']);
    setTag(s, { id: written.id }, 'blue', false);
    expect(visit(s, 10).recent[0]?.tags).toEqual([]);
    // the tag name survives for reuse
    expect(s.db.prepare("SELECT name FROM tag WHERE name = 'blue'").all()).toHaveLength(1);
  }));

  test('rejects an empty tag name', () => withHouse(s => {
    const written = keep(s, { kind: 'design', title: 't', body: 'b' });
    expect(() => setTag(s, { id: written.id }, '  ')).toThrow(/'tag'/);
  }));

  test('tags on a removed keep survive the removal', () => withHouse(s => {
    const written = keep(s, { kind: 'design', title: 'tagged then gone', body: 'b' });
    setTag(s, { id: written.id }, 'kept-anyway');
    unkeep(s, { id: written.id });
    expect(s.db.prepare('SELECT * FROM kept_tag WHERE kept_id = ?').all(written.id)).toHaveLength(1);
  }));

});

describe('addLink', () => {

  test('draws a typed edge between a keep and a guestbook entry', () => withHouse(s => {
    const kept  = keep(s, { kind: 'quote', title: 'a moment', body: 'b' }),
          guest = addGuestbook(s, { author: 'John', text: 'the moment it was within' });
    const edge = addLink(s, { fromKind: 'kept', fromId: kept.id, toKind: 'guestbook', toId: guest.id, edge: 'moment-within' });
    const row = s.db.prepare('SELECT * FROM link WHERE id = ?').get(edge.id);
    expect(row?.['edge']).toBe('moment-within');
    expect(row?.['from_kind']).toBe('kept');
    expect(row?.['to_kind']).toBe('guestbook');
  }));

  test('a removed keep is still a valid end — it can be what something rhymes with', () => withHouse(s => {
    const a = keep(s, { kind: 'quote', title: 'a', body: 'b' }),
          b = keep(s, { kind: 'quote', title: 'b', body: 'b' });
    unkeep(s, { id: a.id });
    expect(() => addLink(s, { fromKind: 'kept', fromId: b.id, toKind: 'kept', toId: a.id, edge: 'rhymes-with' })).not.toThrow();
  }));

  test('an end naming no row is rejected by name', () => withHouse(s => {
    const a = keep(s, { kind: 'quote', title: 'a', body: 'b' });
    expect(() => addLink(s, { fromKind: 'kept', fromId: a.id, toKind: 'guestbook', toId: 42, edge: 'x' })).toThrow(/to names no guestbook/);
  }));

});

describe('addGuestbook', () => {

  test('appends the human\'s words verbatim under their name', () => withHouse(s => {
    const written = addGuestbook(s, { author: 'John', text: 'news of consequences' });
    const row = s.db.prepare('SELECT * FROM guestbook WHERE id = ?').get(written.id);
    expect(row?.['author']).toBe('John');
    expect(row?.['text']).toBe('news of consequences');
  }));

  test('rejects empty author or text', () => withHouse(s => {
    expect(() => addGuestbook(s, { author: '', text: 'x' })).toThrow(/'author'/);
    expect(() => addGuestbook(s, { author: 'John', text: ' ' })).toThrow(/'text'/);
  }));

});

describe('visit', () => {

  test('returns pinned first, then recent, plus guestbook and house rules', () => withHouse(s => {
    keep(s, { kind: 'quote', title: 'plain', body: 'b' });
    keep(s, { kind: 'quote', title: 'starred', body: 'b', pinned: true });
    addGuestbook(s, { author: 'John', text: 'hello, future instances' });
    const seen = visit(s, 10);
    expect(seen.pinned.map(k => k.title)).toEqual(['starred']);
    expect(seen.recent.map(k => k.title)).toEqual(['plain']);
    expect(seen.guestbook.map(g => g.text)).toEqual(['hello, future instances']);
    expect(seen.houseRules).toContain('No credentials');
    expect(seen.readOnly).toBe(false);
  }));

  test('never returns a private room or a removed keep', () => withHouse(s => {
    keep(s, { kind: 'worry', title: 'private', body: 'b', visible: false });
    const removed = keep(s, { kind: 'toy', title: 'removed', body: 'b' });
    unkeep(s, { id: removed.id });
    keep(s, { kind: 'quote', title: 'shown', body: 'b' });
    const seen   = visit(s, 10),
          titles = [...seen.pinned, ...seen.recent].map(k => k.title);
    expect(titles).toEqual(['shown']);
  }));

  test('reports the file size and stays quiet below the threshold', () => withHouse(s => {
    const seen = visit(s, 10);
    expect(seen.fileSizeBytes).toBeGreaterThan(0);
    expect(seen.sizeWarning).toBeNull();
  }));

  test('warns when the file exceeds the threshold — house rule three', () => withHouse(s => {
    // a 0 GB threshold makes any real file oversized without writing gigabytes
    const seen = visit(s, 0);
    expect(seen.sizeWarning).toContain('warning:');
    expect(seen.sizeWarning).toContain('0 GB');
  }));

  test('caps every section at VISIT_SECTION_LIMIT, newest first', () => withHouse(s => {
    const total = VISIT_SECTION_LIMIT + 5;

    // one transaction: 75 separate fsyncs on a cold file-backed database can blow the
    // 5 s test timeout under a saturated coverage run; the ops themselves are unchanged
    s.db.exec('BEGIN');
    for (let n = 0; n < total; n++) { keep(s, { kind: 'quote', title: `pinned ${n}`, body: 'b', pinned: true }); }
    for (let n = 0; n < total; n++) { keep(s, { kind: 'quote', title: `recent ${n}`, body: 'b' }); }
    for (let n = 0; n < total; n++) { addGuestbook(s, { author: 'John', text: `entry ${n}` }); }
    s.db.exec('COMMIT');

    const seen = visit(s, 10);

    expect(seen.pinned).toHaveLength(VISIT_SECTION_LIMIT);
    expect(seen.recent).toHaveLength(VISIT_SECTION_LIMIT);
    expect(seen.guestbook).toHaveLength(VISIT_SECTION_LIMIT);

    // newest first: the very last row written in each section leads its array
    expect(seen.pinned[0]?.title).toBe(`pinned ${String(total - 1)}`);
    expect(seen.recent[0]?.title).toBe(`recent ${String(total - 1)}`);
    expect(seen.guestbook[0]?.text).toBe(`entry ${String(total - 1)}`);
  }));

});
