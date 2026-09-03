/**
 * The messagebox facility (issue #41): posting, delivery, and receipts.
 *
 * A **message** is one row: sender identity (observed, not asserted), a closed
 * audience tag, an optional box scoping agent coordination, text, and an optional
 * expiry. A **receipt** is one append-only row recording that a particular reader
 * collected a particular message at a particular moment — read-state is never a
 * mutable flag, so "who read this, and when" stays a fact the record can answer and
 * multiple readers each get their own receipt. **Unread** is a computed predicate: no
 * receipt from this reader, and not expired. Expiry excludes from delivery; it never
 * deletes — deletion belongs to `retention.days` and nothing else.
 *
 * Validation happens here rather than being left to the database, so a rejection can
 * say what would have worked; the schema's `CHECK` clauses remain the second line of
 * defence, exactly as `entries.ts` does it.
 *
 * @see ./vocabulary.js
 * @see ./schema.js
 * @see ../mcp/message_tools.js
 */

import { randomUUID } from 'node:crypto';
import { AUDIENCES, isMember, describeVocabulary } from './vocabulary.js';
import type { Audience } from './vocabulary.js';
import { stamp }         from './time.js';
import type { Store }    from './store.js';
import type { Written }  from './entries.js';

/**
 * The longest message text accepted, in characters.
 *
 * A message is a payload, not a signature line, so it gets room for a handoff note or
 * a status report — but an uncapped column invites pasting transcripts, and a message
 * that needs more than this is a file, whose *path* is the message.
 */
export const MESSAGE_TEXT_MAX = 2000;

/**
 * What a caller supplies when posting. Timestamps, uuid, and machine identity are
 * filled in by {@link postMessage} rather than accepted, so they cannot be spoofed or
 * forgotten — the same contract `EntryInput` keeps.
 */
export interface MessageInput {
  readonly audience    : Audience;
  readonly text        : string;
  /** The sender's session, usually adopted from `turn_context` at the tool layer. */
  readonly session     : string;
  /** Named topic scoping agent coordination; REQUIRED when audience is `agents`. */
  readonly box?        : string | undefined;
  /** Id of an earlier message this replies to; must exist. */
  readonly replyTo?    : number | undefined;
  /** ISO instant after which the message is excluded from delivery — never deleted. */
  readonly expiresUtc? : string | undefined;
  readonly promptId?   : string | undefined;
  readonly agentId?    : string | undefined;
  readonly agentType?  : string | undefined;
}

/**
 * Who is collecting. `reader` separates the model's receipts from the human's — the
 * facility never lets one party write the other's receipt. For `reader: 'model'`,
 * `agentId` (falling back to `session`) identifies the collecting agent for `agents`
 * delivery, and `session` fences `self` delivery.
 */
export interface Reader {
  readonly reader    : 'model' | 'user';
  readonly session?  : string | undefined;
  readonly agentId?  : string | undefined;
  readonly promptId? : string | undefined;
}

/** What a caller supplies when reading. */
export interface ReadQuery {
  /** Omit for the reader's default deliveries: `self`, plus `agents` when `box` is given. */
  readonly audience? : Audience | undefined;
  /** Box filter; REQUIRED when reading `agents`, mirroring the posting rule. */
  readonly box?      : string | undefined;
  /** Default true: return unread and write receipts. False = peek at recent history. */
  readonly ack?      : boolean | undefined;
  /** Most messages returned; default 20, capped at 100. */
  readonly limit?    : number | undefined;
}

/**
 * Check a proposed message against the vocabulary and the facility's rules,
 * returning every problem found rather than throwing on the first — a caller
 * supplying two bad values learns about both in one round trip.
 *
 * The `replyTo`-must-exist rule needs the store, so it lives in {@link postMessage}.
 *
 * @example
 *   validateMessage({ audience: 'self', text: 'resume at step 3', session: 's1' })  // => []
 *   validateMessage({ audience: 'agents', text: 'task 3 green', session: 's1' })
 *   // => ["audience 'agents' requires a box — an unscoped agent message would be ..."]
 */
export function validateMessage(input: MessageInput): string[] {

  const problems: string[] = [];

  if (!isMember(AUDIENCES, input.audience)) {
    problems.push(
      `'${String(input.audience)}' is not a valid audience; expected ${describeVocabulary(AUDIENCES)}`);
  }

  if (input.text.trim() === '')    { problems.push('text must not be empty'); }
  if (input.session.trim() === '') { problems.push('session must not be empty'); }

  if (input.text.length > MESSAGE_TEXT_MAX) {
    problems.push(
      `text must be at most ${String(MESSAGE_TEXT_MAX)} characters ` +
      `(received ${String(input.text.length)}) — a longer message is a file, whose path is the message`);
  }

  if (input.audience === 'agents' && (input.box?.trim() ?? '') === '') {
    problems.push(
      "audience 'agents' requires a box — an unscoped agent message would be delivered " +
      'to every concurrent multi-agent job sharing the database');
  }

  if (input.box?.trim() === '') {
    problems.push('box must not be blank when supplied');
  }

  if (input.expiresUtc !== undefined && Number.isNaN(Date.parse(input.expiresUtc))) {
    problems.push(
      `expiresUtc must parse as an ISO instant; received '${input.expiresUtc}'`);
  }

  return problems;

}

/**
 * Post one message, returning its identity.
 *
 * Generates the uuid, all three timestamps, and the machine identity rather than
 * accepting them. `when` is injectable so tests can pin the clock.
 *
 * @param when injectable clock; defaults to now
 *
 * @example
 *   postMessage(store, { audience: 'self', text: 'resume at step 3 of the plan',
 *                        session: 's1' }, '0.2.1')
 *   // => { id: 1, uuid: '…' }
 *
 * @throws {Error} If validation fails — audience outside the vocabulary, empty or
 *                 over-cap text, a boxless `agents` post, an unparseable expiry, or a
 *                 `replyTo` naming no existing message — naming every problem.
 *
 * @see validateMessage
 */
export function postMessage(
  store         : Store,
  input         : MessageInput,
  pluginVersion : string,
  when          : Date = new Date(),
): Written {

  const problems = validateMessage(input);

  if (input.replyTo !== undefined && problems.length === 0) {
    const target = store.db.prepare('SELECT 1 AS found FROM messages WHERE id = ?').get(input.replyTo);
    if (target === undefined) {
      problems.push(`replyTo #${String(input.replyTo)} does not reference an existing message`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`cannot post message:\n  - ${problems.join('\n  - ')}`);
  }

  const at   = stamp(when),
        uuid = randomUUID();

  store.db.prepare(`
    INSERT INTO messages (
      uuid, ts_utc, ts_local, tz,
      session, prompt_id, agent_id, agent_type, machine_id,
      audience, box, reply_to, text, expires_utc,
      plugin_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuid, at.utc, at.local, at.tz,
    input.session, input.promptId ?? null, input.agentId ?? null, input.agentType ?? null,
    store.machineId,
    input.audience, input.box ?? null, input.replyTo ?? null, input.text,
    input.expiresUtc === undefined ? null : new Date(input.expiresUtc).toISOString(),
    pluginVersion,
  );

  const row = store.db.prepare('SELECT last_insert_rowid() AS id').get(),
        id  = Number(row?.['id'] ?? 0);

  return { id, uuid };

}

/** The not-yet-expired predicate, shared by every delivery query. */
const NOT_EXPIRED = '(m.expires_utc IS NULL OR m.expires_utc > ?)';

/**
 * The not-a-held-note predicate, applied to `user` **delivery** only (issue #43).
 *
 * A held note is stored as a `user` message with a `notes` sidecar, so that one table
 * carries every assistant-authored text. Its delivery, though, is governed by the note
 * ladder — `not_before`, budgets, offers, `surfaced` — and letting it *also* count as
 * ordinary unread `user` mail would give one text two disagreeing delivery records, plus
 * a per-turn count line nagging about a note deliberately timed for Tuesday. So notes
 * are excluded from the unread set and the unread count, and from nowhere else: the
 * peek view (`ack: false`) still shows them, because they genuinely are part of the
 * history, and peeking makes no claim about delivery.
 *
 * @see ./notes.js
 */
const NOT_A_NOTE = 'NOT EXISTS (SELECT 1 FROM notes n WHERE n.message_id = m.id)';

/** The columns every read returns, in recording order. */
const MESSAGE_COLUMNS =
  'm.id, m.uuid, m.ts_utc, m.ts_local, m.tz, m.session, m.prompt_id, m.agent_id, ' +
  'm.audience, m.box, m.reply_to, m.text, m.expires_utc';

/**
 * Whether this audience-reader pairing is allowed to write receipts.
 *
 * `self` and `agents` are collected by the model; `user` only by the human — the
 * model relaying a message is not the user reading it, so a model read of `user` mail
 * never receipts regardless of `ack`. `record` has nothing to deliver, only to
 * consult, so it never receipts for anyone.
 */
function mayReceipt(audience: Audience, reader: Reader): boolean {
  if (audience === 'record') { return false; }
  if (audience === 'user')   { return reader.reader === 'user'; }
  return reader.reader === 'model';
}

/** Append one receipt row for each delivered message. */
function receipt(store: Store, ids: readonly number[], reader: Reader, when: Date): void {
  const insert = store.db.prepare(
    'INSERT INTO message_reads (message_id, ts_utc, reader, session, agent_id, prompt_id) VALUES (?,?,?,?,?,?)');
  for (const id of ids) {
    insert.run(id, stamp(when).utc, reader.reader,
               reader.session ?? null, reader.agentId ?? null, reader.promptId ?? null);
  }
}

/** The unread rows for one audience, for one reader, oldest first. */
function unreadRowsFor(
  store    : Store,
  audience : Audience,
  reader   : Reader,
  box      : string | undefined,
  limit    : number,
  nowUtc   : string,
): Record<string, unknown>[] {

  if (audience === 'self') {
    if (reader.session === undefined || reader.session === '') { return []; }
    return store.db.prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
        WHERE m.audience = 'self' AND m.session = ? AND ${NOT_EXPIRED}
          AND NOT EXISTS (SELECT 1 FROM message_reads r
                           WHERE r.message_id = m.id AND r.reader = 'model' AND r.session = ?)
        ORDER BY m.id ASC LIMIT ?`).all(reader.session, nowUtc, reader.session, limit);
  }

  if (audience === 'agents') {
    const key = reader.agentId ?? reader.session;
    if (box === undefined || key === undefined || key === '') { return []; }
    return store.db.prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
        WHERE m.audience = 'agents' AND m.box = ? AND ${NOT_EXPIRED}
          AND NOT EXISTS (SELECT 1 FROM message_reads r
                           WHERE r.message_id = m.id AND r.reader = 'model'
                             AND COALESCE(r.agent_id, r.session) = ?)
        ORDER BY m.id ASC LIMIT ?`).all(box, nowUtc, key, limit);
  }

  if (audience === 'user') {
    return store.db.prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
        WHERE m.audience = 'user' AND ${NOT_EXPIRED} AND ${NOT_A_NOTE}
          AND NOT EXISTS (SELECT 1 FROM message_reads r
                           WHERE r.message_id = m.id AND r.reader = 'user')
        ORDER BY m.id ASC LIMIT ?`).all(nowUtc, limit);
  }

  // 'record' has no unread concept — nothing to deliver, only to consult.
  return [];

}

/** The recent rows for one audience regardless of receipts — the peek view, oldest first. */
function recentRows(
  store    : Store,
  audience : Audience,
  reader   : Reader,
  box      : string | undefined,
  limit    : number,
): Record<string, unknown>[] {

  // A model peeking at `self` is still fenced to its own session — the read tool must
  // never return another session's self notes even when asked (spec, § Privacy). The
  // human reader owns the disk, so an unfenced user peek is honest rather than a leak.
  if (audience === 'self' && reader.reader === 'model') {
    if (reader.session === undefined || reader.session === '') { return []; }
    return store.db.prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
        WHERE m.audience = 'self' AND m.session = ?
        ORDER BY m.id DESC LIMIT ?`).all(reader.session, limit).reverse();
  }

  if (box !== undefined) {
    return store.db.prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
        WHERE m.audience = ? AND m.box = ?
        ORDER BY m.id DESC LIMIT ?`).all(audience, box, limit).reverse();
  }

  return store.db.prepare(
    `SELECT ${MESSAGE_COLUMNS} FROM messages m
      WHERE m.audience = ?
      ORDER BY m.id DESC LIMIT ?`).all(audience, limit).reverse();

}

/**
 * Read messages for one reader: the unread deliveries with `ack: true` (the default,
 * writing one receipt per returned message), or the recent history with `ack: false`
 * (a peek — nothing is receipted, nothing is consumed).
 *
 * Per-audience delivery semantics:
 *
 * - `self` — fenced to the reader's session; another session's notes are unreachable.
 * - `agents` — fenced to the given `box`; receipt identity is `agentId`, falling back
 *   to session, so sibling agents each get their own delivery.
 * - `user` — collected by the human; a model reader is handed the unread mail **without
 *   receipting regardless of `ack`**, because relaying is not reading. Only a
 *   `reader: 'user'` (the CLI) writes `user` receipts. Held notes (#43) are excluded
 *   from the *unread* set — their delivery is the note ladder's — but remain visible in
 *   the `ack: false` peek, which claims nothing about delivery.
 * - `record` — never unread; delivery-mode reads return the recent history instead,
 *   and nothing ever receipts.
 *
 * With no `audience`, a model reader gets its default deliveries: unread `self`, plus
 * unread `agents` in `box` when one is supplied.
 *
 * Nothing is ever delivered twice to the same reader: delivery writes receipts, and
 * unread is defined by their absence.
 *
 * @param when injectable clock for expiry evaluation and receipt timestamps
 * @returns the matching messages, oldest first
 *
 * @example
 *   postMessage(store, { audience: 'self', text: 'resume at step 3', session: 's1' }, v);
 *   readMessages(store, { reader: 'model', session: 's1' }, {})            // => [that message]
 *   readMessages(store, { reader: 'model', session: 's1' }, {})            // => [] — receipted
 *
 * @see postMessage
 * @see unreadCounts
 */
export function readMessages(
  store  : Store,
  reader : Reader,
  query  : ReadQuery,
  when   : Date = new Date(),
): Record<string, unknown>[] {

  const ack    = query.ack ?? true,
        limit  = Math.min(Math.max(query.limit ?? 20, 1), 100),
        nowUtc = when.toISOString();

  const audiences: readonly Audience[] =
    query.audience !== undefined ? [query.audience]
    : query.box !== undefined    ? ['self', 'agents']
    :                              ['self'];

  const out: Record<string, unknown>[] = [];

  for (const audience of audiences) {

    const rows = (!ack || audience === 'record')
      ? recentRows(store, audience, reader, query.box, limit)
      : unreadRowsFor(store, audience, reader, query.box, limit, nowUtc);

    if (ack && mayReceipt(audience, reader)) {
      receipt(store, rows.map(r => Number(r['id'])), reader, when);
    }

    out.push(...rows);

  }

  return out;

}

/** The most unread `self` rows {@link unreadRows} will ever scan for one session. */
const UNREAD_SELF_SCAN_LIMIT = 100;

/**
 * The unread `self` message rows for one session, without writing receipts (issue #98).
 *
 * Exists for the pending-notice collector ({@link ../pending.js collectPending}), which
 * needs to know *whether* mail is waiting without *consuming* it: calling
 * {@link readMessages} would write a receipt for every row it returned, permanently
 * removing those messages from the reader's actual unread mail the moment a background
 * check merely glanced at it. This is the read-only half of what {@link readMessages}
 * does for `audience: 'self'` with a model reader, exposed on its own so a caller can
 * peek at true unread state — not the `ack: false` history peek, which would also
 * surface already-read rows.
 *
 * @param when injectable clock for expiry evaluation; defaults to now
 * @returns the unread `self` rows for `session`, oldest first, capped at
 *          {@link UNREAD_SELF_SCAN_LIMIT}; `[]` for an empty session
 *
 * @example
 *   postMessage(store, { audience: 'self', text: 'resume at step 3', session: 's1' }, v);
 *   unreadRows(store, 's1')  // => [{ id: 1, text: 'resume at step 3', ts_utc: '…', … }]
 *   readMessages(store, { reader: 'model', session: 's1' }, {});
 *   unreadRows(store, 's1')  // => [] — that receipt is real, this peek respects it
 *
 * @see readMessages
 * @see unreadCounts
 */
export function unreadRows(
  store   : Store,
  session : string,
  when    : Date = new Date(),
): Record<string, unknown>[] {
  if (session === '') { return []; }
  return unreadRowsFor(store, 'self', { reader: 'model', session }, undefined,
                        UNREAD_SELF_SCAN_LIMIT, when.toISOString());
}

/** The unread tallies the per-turn hook reports. */
export interface UnreadCounts {
  /** Unread `self` notes for the given session; 0 when no session is known. */
  readonly forModel : number;
  /** Unread `user` mail awaiting the human. */
  readonly forUser  : number;
}

/**
 * How many messages await each party — the per-turn count line's data.
 *
 * Counts only, never text: full injection every turn would spend context on notes the
 * model usually still remembers. `agents` mail is deliberately excluded — workers poll
 * their box by instruction, not by ambient nag — and `record` never counts as unread.
 * Held notes (#43) are excluded from `forUser` too: their delivery is the note ladder's,
 * and counting them here would nag about a note deliberately timed for later.
 *
 * @param session the reader session fencing the `self` count; omit for user-only
 * @param when    injectable clock for expiry evaluation
 *
 * @example
 *   unreadCounts(store, 's1')  // => { forModel: 2, forUser: 1 }
 *
 * @see readMessages
 */
export function unreadCounts(store: Store, session?: string, when: Date = new Date()): UnreadCounts {

  const nowUtc = when.toISOString();

  const forModel = session === undefined || session === '' ? 0 : Number(store.db.prepare(
    `SELECT COUNT(*) AS n FROM messages m
      WHERE m.audience = 'self' AND m.session = ? AND ${NOT_EXPIRED}
        AND NOT EXISTS (SELECT 1 FROM message_reads r
                         WHERE r.message_id = m.id AND r.reader = 'model' AND r.session = ?)`)
    .get(session, nowUtc, session)?.['n'] ?? 0);

  const forUser = Number(store.db.prepare(
    `SELECT COUNT(*) AS n FROM messages m
      WHERE m.audience = 'user' AND ${NOT_EXPIRED} AND ${NOT_A_NOTE}
        AND NOT EXISTS (SELECT 1 FROM message_reads r
                         WHERE r.message_id = m.id AND r.reader = 'user')`)
    .get(nowUtc)?.['n'] ?? 0);

  return { forModel, forUser };

}

/**
 * Render read messages human-first, one line per message, for the CLI's direct door.
 *
 * @returns the printable report; a stated "no messages." rather than emptiness
 *
 * @example
 *   formatMessages([{ id: 4, ts_local: '9:14 am PDT', audience: 'user', box: null,
 *                     session: 'sess-1', text: 'chart drifted' }])
 *   // => '#4 · 9:14 am PDT · user · from sess-1: chart drifted'
 */
export function formatMessages(rows: readonly Record<string, unknown>[]): string {

  if (rows.length === 0) { return 'no messages.'; }

  return rows.map(row => {
    const boxValue = row['box'],
          box      = typeof boxValue === 'string' && boxValue !== '' ? ` · box ${boxValue}` : '';
    return `#${String(row['id'])} · ${String(row['ts_local'])} · ${String(row['audience'])}${box}` +
           ` · from ${String(row['session'])}: ${String(row['text'])}`;
  }).join('\n');

}
