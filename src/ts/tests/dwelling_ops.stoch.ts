/**
 * Stochastic property tests for the dwelling's tombstone and arrangement invariants.
 *
 * Three properties the spec names outright: `unkeep` is idempotent however many times
 * it lands; `visit` never returns a private (`visible = 0`) or removed row, whatever
 * the sequence of keeps, pins, and removals; and adoption of a pre-plugin prototype
 * never alters pre-existing row content, whatever that content is. All databases are
 * temp-directory fixtures created here — never anyone's real dwelling.
 */

import { mkdtempSync, rmSync }  from 'node:fs';
import { tmpdir }               from 'node:os';
import { join }                 from 'node:path';
import { DatabaseSync }         from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openDwelling, closeDwelling } from '../dwelling/store.js';
import { keep, unkeep, pin, visit }    from '../dwelling/ops.js';

const keepArb = fc.record({
  kind    : fc.string({ minLength: 1, maxLength: 12 }).filter(s => s.trim() !== ''),
  title   : fc.string({ minLength: 1, maxLength: 24 }).filter(s => s.trim() !== ''),
  body    : fc.string({ minLength: 1, maxLength: 80 }).filter(s => s.trim() !== ''),
  visible : fc.boolean(),
  pinned  : fc.boolean(),
});

describe('dwelling invariants — stochastic', () => {

  it('unkeep is idempotent: any number of removals leaves one unchanged tombstone', () => {

    const dir   = mkdtempSync(join(tmpdir(), 'se-dwell-stoch-')),
          house = openDwelling(join(dir, 'dwelling.sqlite3'));

    try {
      fc.assert(
        fc.property(keepArb, fc.integer({ min: 2, max: 6 }), (args, removals) => {

          const written = keep(house, args);
          const first   = unkeep(house, { id: written.id });

          for (let n = 1; n < removals; n++) {
            const again = unkeep(house, { id: written.id });
            expect(again.already).toBe(true);
            expect(again.removed_utc).toBe(first.removed_utc);
          }

          const row = house.db.prepare('SELECT * FROM kept WHERE id = ?').get(written.id);
          expect(row?.['removed_utc']).toBe(first.removed_utc);
          expect(row?.['title']).toBe(args.title);

        }),
        { numRuns: 25 },
      );
    } finally {
      closeDwelling(house); rmSync(dir, { recursive: true, force: true });
    }

  }, 60000);   // SQLite on a loaded Windows CI is slow; the property, not the clock, is the test

  it('visit never returns a private or removed row, whatever the arrangement history', () => {

    const dir   = mkdtempSync(join(tmpdir(), 'se-dwell-stoch-')),
          house = openDwelling(join(dir, 'dwelling.sqlite3'));

    try {
      fc.assert(
        fc.property(
          fc.array(fc.record({ args: keepArb, remove: fc.boolean(), repin: fc.boolean() }), { minLength: 1, maxLength: 8 }),
          (plans) => {

            const expectVisible: number[] = [];

            for (const plan of plans) {
              const written = keep(house, plan.args);
              if (plan.repin)  { pin(house, { id: written.id }); }
              if (plan.remove) { unkeep(house, { id: written.id }); }
              else if (plan.args.visible) { expectVisible.push(written.id); }
            }

            const seen = visit(house, 10),
                  ids  = [...seen.pinned, ...seen.recent].map(k => k.id);

            // every id this run expected is present, and nothing hidden ever leaks
            for (const id of expectVisible) { expect(ids).toContain(id); }
            for (const id of ids) {
              const row = house.db.prepare('SELECT visible, removed_utc FROM kept WHERE id = ?').get(id);
              expect(Number(row?.['visible'])).toBe(1);
              expect(row?.['removed_utc']).toBeNull();
            }

          },
        ),
        { numRuns: 15 },
      );
    } finally {
      closeDwelling(house); rmSync(dir, { recursive: true, force: true });
    }

  }, 60000);   // shared store accumulates rows across runs; time grows with the run count

  it('adoption never alters pre-existing row content, whatever the prototype holds', () => {

    fc.assert(
      fc.property(
        fc.array(fc.record({
          added : fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2026-08-01T00:00:00Z'), noInvalidDate: true }),
          kind  : fc.string({ minLength: 1, maxLength: 10 }),
          title : fc.string({ minLength: 1, maxLength: 30 }),
          body  : fc.string({ minLength: 1, maxLength: 120 }),
        }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.record({
          author : fc.string({ minLength: 1, maxLength: 20 }),
          text   : fc.string({ minLength: 1, maxLength: 120 }),
        }), { minLength: 0, maxLength: 4 }),
        (keeps, guests) => {

          const dir  = mkdtempSync(join(tmpdir(), 'se-dwell-stoch-adopt-')),
                path = join(dir, 'dwelling.sqlite3');

          try {

            const proto = new DatabaseSync(path);
            proto.exec('CREATE TABLE kept (id INTEGER PRIMARY KEY AUTOINCREMENT, added_utc TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL)');
            proto.exec('CREATE TABLE guestbook (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_utc TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL)');
            for (const row of keeps)  { proto.prepare('INSERT INTO kept (added_utc, kind, title, body) VALUES (?,?,?,?)').run(row.added.toISOString(), row.kind, row.title, row.body); }
            for (const row of guests) { proto.prepare('INSERT INTO guestbook (ts_utc, author, text) VALUES (?,?,?)').run('2026-08-27T00:00:00.000Z', row.author, row.text); }
            proto.close();

            const house = openDwelling(path);

            const adoptedKeeps = house.db.prepare('SELECT * FROM kept ORDER BY id').all();
            expect(adoptedKeeps).toHaveLength(keeps.length);
            for (const [index, original] of keeps.entries()) {
              const adopted = adoptedKeeps[index];
              expect(adopted?.['added_utc']).toBe(original.added.toISOString());
              expect(adopted?.['kind']).toBe(original.kind);
              expect(adopted?.['title']).toBe(original.title);
              expect(adopted?.['body']).toBe(original.body);
              expect(String(adopted?.['uuid'])).toMatch(/^[0-9a-f-]{36}$/);
            }

            const adoptedGuests = house.db.prepare('SELECT * FROM guestbook ORDER BY id').all();
            expect(adoptedGuests).toHaveLength(guests.length);
            for (const [index, original] of guests.entries()) {
              expect(adoptedGuests[index]?.['author']).toBe(original.author);
              expect(adoptedGuests[index]?.['text']).toBe(original.text);
            }

            expect(house.adoptedBackup).not.toBeNull();
            closeDwelling(house);

          } finally {
            rmSync(dir, { recursive: true, force: true });
          }

        },
      ),
      { numRuns: 8 },
    );

  }, 60000);   // each run creates, adopts, and backs up a fresh database — slow on Windows

});
