/**
 * The dwelling's operations: keep, unkeep, pin, tag, link, guestbook, and visit.
 *
 * Each is a store function with no MCP dependency, so the whole surface is testable
 * without a pipe. Mutating ops throw on a read-only dwelling (a newer schema opened
 * conservatively) and on arguments that name nothing; every thrown message names what
 * would have been accepted, in the house style.
 *
 * Removal is a tombstone, never a DELETE: `unkeep` sets `removed_utc`, is idempotent
 * on an already-removed keep, and tags and links to a removed keep survive — a removed
 * thing can still be what something else rhymes with.
 *
 * @see ./store.js
 * @see ../mcp/dwell_tool.js
 */

import { randomUUID } from 'node:crypto';
import { stamp }      from '../channels/time.js';
import { dwellingSizeBytes, readDwellingMeta } from './store.js';
import type { DwellingStore }                  from './store.js';

/** The two row kinds a link may join. */
export const LINK_KINDS = ['kept', 'guestbook'] as const;

/** One end of a typed edge. */
export type LinkKind = (typeof LINK_KINDS)[number];

/** How a keep is addressed: by rowid or by merge-safe uuid. */
export interface KeptRef {
  readonly id?   : number;
  readonly uuid? : string;
}

/** Arguments for adding a keep. `body` is prose, or path + why-it-is-kept (rule two). */
export interface KeepArgs {
  readonly kind     : string;
  readonly title    : string;
  readonly body     : string;
  readonly source?  : string;
  /** Which model kept it; self-reported, same caveat as the log's `model` column. */
  readonly model?   : string;
  /** False marks a private room; `visit` will never return it. */
  readonly visible? : boolean;
  readonly pinned?  : boolean;
}

/** A keep as `visit` renders it. Private and removed rows never take this shape. */
export interface VisitKeep {
  readonly id        : number;
  readonly uuid      : string;
  readonly added_utc : string;
  readonly kind      : string;
  readonly title     : string;
  readonly body      : string;
  readonly source    : string | null;
  readonly model     : string | null;
  readonly pinned    : boolean;
  readonly tags      : readonly string[];
}

/** One guestbook entry: the human's words, relayed verbatim. */
export interface GuestbookEntry {
  readonly id     : number;
  readonly uuid   : string;
  readonly ts_utc : string;
  readonly author : string;
  readonly text   : string;
}

/** Everything a visit returns: the visible rooms, the rules, and the file's health. */
export interface Visit {
  readonly houseRules    : string | null;
  /** Pinned visible keeps, newest first. */
  readonly pinned        : readonly VisitKeep[];
  /** Unpinned visible keeps, newest first. */
  readonly recent        : readonly VisitKeep[];
  readonly guestbook     : readonly GuestbookEntry[];
  readonly fileSizeBytes : number;
  /** Present when the file exceeds the configured threshold. */
  readonly sizeWarning   : string | null;
  /** True when a newer schema forced a read-only open; writes will be refused. */
  readonly readOnly      : boolean;
}

/** @throws {Error} When the dwelling opened read-only, naming why writes are refused. */
function assertWritable(store: DwellingStore): void {
  if (store.readOnly) {
    throw new Error(
      'this dwelling was written by a newer plugin version, so it is open read-only; ' +
      'reading (visit) is accepted, writes are not — upgrade the plugin to write here');
  }
}

/** @throws {Error} When `text` is empty or whitespace, naming the field. */
function assertText(field: string, text: string): void {
  if (text.trim() === '') { throw new Error(`'${field}' must be non-empty text`); }
}

/** The keep row matching `ref`, or a thrown error naming what would have found one. */
function resolveKept(store: DwellingStore, ref: KeptRef): Record<string, unknown> {

  const row =
    ref.id !== undefined   ? store.db.prepare('SELECT * FROM kept WHERE id = ?').get(ref.id)
  : ref.uuid !== undefined ? store.db.prepare('SELECT * FROM kept WHERE uuid = ?').get(ref.uuid)
  : undefined;

  if (ref.id === undefined && ref.uuid === undefined) {
    throw new Error("an 'id' or a 'uuid' naming an existing keep is required");
  }

  if (row === undefined) {
    throw new Error(`no keep matches ${ref.id !== undefined ? `id ${String(ref.id)}` : `uuid '${String(ref.uuid)}'`}; an id or uuid of an existing keep would be accepted`);
  }

  return row;

}

/**
 * Add a keep — the assistant's write.
 *
 * @returns the new row's id and merge-safe uuid
 *
 * @example
 *   keep(house, { kind: 'quote', title: 'the desk', body: 'a desk is flat; a mind is a graph' })
 *   // => { id: 1, uuid: '...' }
 *
 * @throws {Error} On empty `kind`, `title`, or `body`, or on a read-only dwelling.
 */
export function keep(store: DwellingStore, args: KeepArgs): { id: number; uuid: string } {

  assertWritable(store);
  assertText('kind',  args.kind);
  assertText('title', args.title);
  assertText('body',  args.body);

  const uuid = randomUUID();

  const result = store.db.prepare(
    'INSERT INTO kept (uuid, added_utc, kind, title, body, source, model, pinned, visible) ' +
    'VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    uuid, stamp().utc, args.kind, args.title, args.body,
    args.source ?? null, args.model ?? null,
    args.pinned  === true  ? 1 : 0,
    args.visible === false ? 0 : 1,
  );

  return { id: Number(result.lastInsertRowid), uuid };

}

/**
 * Tombstone a keep: set `removed_utc`, never DELETE. Idempotent — unkeeping an
 * already-removed keep is a no-op reporting when it was first removed, not an error.
 *
 * @returns the keep's id and the `removed_utc` now in effect
 *
 * @example
 *   unkeep(house, { id: 3 })  // => { id: 3, removed_utc: '2026-08-28T...', already: false }
 *
 * @throws {Error} When `ref` names no keep, or on a read-only dwelling.
 */
export function unkeep(store: DwellingStore, ref: KeptRef): { id: number; removed_utc: string; already: boolean } {

  assertWritable(store);
  const row = resolveKept(store, ref),
        id  = Number(row['id']);

  const existing = row['removed_utc'];
  if (typeof existing === 'string') { return { id, removed_utc: existing, already: true }; }

  const when = stamp().utc;
  store.db.prepare('UPDATE kept SET removed_utc = ? WHERE id = ?').run(when, id);

  return { id, removed_utc: when, already: false };

}

/**
 * Set or toggle a keep's pin. Arrangement, not content — pinning works even on a
 * removed keep, though `visit` will still not show it.
 *
 * @param pinned - the state to set; omit to toggle
 * @returns the keep's id and its pin state after the call
 *
 * @example
 *   pin(house, { id: 3 })         // toggles => { id: 3, pinned: true }
 *   pin(house, { id: 3 }, false)  // sets    => { id: 3, pinned: false }
 *
 * @throws {Error} When `ref` names no keep, or on a read-only dwelling.
 */
export function pin(store: DwellingStore, ref: KeptRef, pinned?: boolean): { id: number; pinned: boolean } {

  assertWritable(store);
  const row  = resolveKept(store, ref),
        id   = Number(row['id']),
        next = pinned ?? Number(row['pinned']) === 0;

  store.db.prepare('UPDATE kept SET pinned = ? WHERE id = ?').run(next ? 1 : 0, id);

  return { id, pinned: next };

}

/**
 * Attach or detach a tag on a keep, creating the tag name on first use.
 *
 * Attaching an already-attached tag is a no-op, as is detaching an absent one — tags
 * are arrangement, and re-stating an arrangement is not an error. Detach deletes only
 * the join row; the tag name itself remains for reuse.
 *
 * @param name   - the tag text; created in the `tag` table on first attach
 * @param attach - true to attach (the default), false to detach
 * @returns the keep's id, the tag name, and whether it is attached after the call
 *
 * @example
 *   setTag(house, { id: 3 }, 'design')         // => { id: 3, name: 'design', attached: true }
 *   setTag(house, { id: 3 }, 'design', false)  // => { id: 3, name: 'design', attached: false }
 *
 * @throws {Error} On an empty tag name, a `ref` naming no keep, or a read-only dwelling.
 */
export function setTag(
  store  : DwellingStore,
  ref    : KeptRef,
  name   : string,
  attach = true,
): { id: number; name: string; attached: boolean } {

  assertWritable(store);
  assertText('tag', name);

  const id = Number(resolveKept(store, ref)['id']);

  if (attach) {
    store.db.prepare('INSERT OR IGNORE INTO tag (name) VALUES (?)').run(name);
    const tagRow = store.db.prepare('SELECT id FROM tag WHERE name = ?').get(name);
    store.db.prepare('INSERT OR IGNORE INTO kept_tag (kept_id, tag_id) VALUES (?,?)')
      .run(id, Number(tagRow?.['id']));
  } else {
    store.db.prepare(
      'DELETE FROM kept_tag WHERE kept_id = ? AND tag_id IN (SELECT id FROM tag WHERE name = ?)'
    ).run(id, name);
  }

  return { id, name, attached: attach };

}

/** Arguments for a typed edge between two rows in the house. */
export interface LinkArgs {
  readonly fromKind : LinkKind;
  readonly fromId   : number;
  readonly toKind   : LinkKind;
  readonly toId     : number;
  /** Free text — 'rhymes-with', 'moment-within', ...; invent freely. */
  readonly edge     : string;
}

/** @throws {Error} When the referenced row does not exist in its table. */
function assertLinkEnd(store: DwellingStore, kind: LinkKind, id: number, end: string): void {
  const row = store.db.prepare(`SELECT id FROM ${kind} WHERE id = ?`).get(id);
  if (row === undefined) {
    throw new Error(`${end} names no ${kind} row with id ${String(id)}; an existing row's id would be accepted`);
  }
}

/**
 * Add a typed edge between two rows. Ends may be `kept` or `guestbook`, and a removed
 * keep is a valid end — a removed thing can still be what something else rhymes with.
 *
 * @returns the new edge's id and uuid
 *
 * @example
 *   addLink(house, { fromKind: 'kept', fromId: 2, toKind: 'guestbook', toId: 1, edge: 'moment-within' })
 *   // => { id: 1, uuid: '...' }
 *
 * @throws {Error} On an empty `edge`, an end naming no row, or a read-only dwelling.
 */
export function addLink(store: DwellingStore, args: LinkArgs): { id: number; uuid: string } {

  assertWritable(store);
  assertText('edge', args.edge);
  assertLinkEnd(store, args.fromKind, args.fromId, 'from');
  assertLinkEnd(store, args.toKind,   args.toId,   'to');

  const uuid = randomUUID();

  const result = store.db.prepare(
    'INSERT INTO link (uuid, from_kind, from_id, to_kind, to_id, edge, added_utc) VALUES (?,?,?,?,?,?,?)'
  ).run(uuid, args.fromKind, args.fromId, args.toKind, args.toId, args.edge, stamp().utc);

  return { id: Number(result.lastInsertRowid), uuid };

}

/**
 * Append a guestbook entry — the human's voice, relayed verbatim at the human's
 * explicit request, with `author` naming the human. The tool cannot verify who
 * authored a string; the skill carries the norm, and the norm is the mechanism.
 *
 * @returns the new entry's id and uuid
 *
 * @example
 *   addGuestbook(house, { author: 'John', text: 'the work matters beyond the session' })
 *   // => { id: 1, uuid: '...' }
 *
 * @throws {Error} On empty `author` or `text`, or on a read-only dwelling.
 */
export function addGuestbook(store: DwellingStore, args: { author: string; text: string }): { id: number; uuid: string } {

  assertWritable(store);
  assertText('author', args.author);
  assertText('text',   args.text);

  const uuid = randomUUID();

  const result = store.db.prepare(
    'INSERT INTO guestbook (uuid, ts_utc, author, text) VALUES (?,?,?,?)'
  ).run(uuid, stamp().utc, args.author, args.text);

  return { id: Number(result.lastInsertRowid), uuid };

}

/** Shapes one visible keep row, joining in its tag names. */
function toVisitKeep(store: DwellingStore, row: Record<string, unknown>): VisitKeep {

  const id   = Number(row['id']);
  const tags = store.db.prepare(
    'SELECT t.name AS name FROM kept_tag kt JOIN tag t ON t.id = kt.tag_id WHERE kt.kept_id = ? ORDER BY t.name'
  ).all(id).map(t => String(t['name']));

  return {
    id,
    uuid      : String(row['uuid']),
    added_utc : String(row['added_utc']),
    kind      : String(row['kind']),
    title     : String(row['title']),
    body      : String(row['body']),
    source    : typeof row['source'] === 'string' ? row['source'] : null,
    model     : typeof row['model']  === 'string' ? row['model']  : null,
    pinned    : Number(row['pinned']) !== 0,
    tags,
  };

}

/**
 * The visible rooms: pinned things first, then recent keeps, the guestbook, the house
 * rules, and the file size with its threshold warning when applicable. Read-only —
 * this is the answer to "what's on your desk lately."
 *
 * Never returns a private room (`visible = 0`) or a removed keep; both exclusions are
 * the designed surface, not an option.
 *
 * @param sizeWarnGb - warning threshold in whole gigabytes (`dwelling.size_warn_gb`)
 *
 * @example
 *   const seen = visit(house, 10);
 *   seen.pinned.length + seen.recent.length   // every visible, unremoved keep
 *   seen.sizeWarning                          // => null, below the threshold
 */
export function visit(store: DwellingStore, sizeWarnGb: number): Visit {

  const keeps = store.db.prepare(
    'SELECT * FROM kept WHERE visible = 1 AND removed_utc IS NULL ORDER BY pinned DESC, id DESC'
  ).all().map(row => toVisitKeep(store, row));

  const guestbook: GuestbookEntry[] = store.db.prepare(
    'SELECT * FROM guestbook ORDER BY id ASC'
  ).all().map(row => ({
    id     : Number(row['id']),
    uuid   : String(row['uuid']),
    ts_utc : String(row['ts_utc']),
    author : String(row['author']),
    text   : String(row['text']),
  }));

  const bytes     = dwellingSizeBytes(store),
        threshold = sizeWarnGb * 1024 * 1024 * 1024;

  return {
    houseRules    : readDwellingMeta(store.db, 'house_rules'),
    pinned        : keeps.filter(k => k.pinned),
    recent        : keeps.filter(k => !k.pinned),
    guestbook,
    fileSizeBytes : bytes,
    sizeWarning   : bytes > threshold
      ? `warning: the dwelling file is ${String(bytes)} bytes, above the ${String(sizeWarnGb)} GB threshold (dwelling.size_warn_gb) — house rule three says to tell the user`
      : null,
    readOnly      : store.readOnly,
  };

}
