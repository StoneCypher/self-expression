/**
 * The pending-notice collector (issue #98): desk requests and unread messages, turned
 * into a one-line notice, emitted only when something about the pending set changes.
 *
 * **The notice is a change signal, not a status bar.** A session that already knows a
 * backlog exists gains nothing from being told again every single turn — that is exactly
 * the fatigue that makes a human stop reading status lines. So the collector computes a
 * *fingerprint* of the pending set — every open item's key, plus how many whole
 * `pending.nag_hours` intervals it has been waiting — and speaks only when that
 * fingerprint moves. It moves when an item appears, when it is claimed away, or when it
 * crosses a nag boundary: those are exactly the moments a session should hear about it,
 * and nothing in between is worth a line.
 *
 * Two sources feed the set today. The **desk** source ({@link openIntents} over
 * `desk.path`'s `questions.json`) surfaces requests nobody has claimed yet. The
 * **message** source ({@link unreadRows} from `channels/messages.ts`) surfaces unread
 * `self` mail for the session — read without receipting, because a background glance
 * must never be the thing that consumes a message the session hasn't actually seen.
 * Both are registered in {@link PENDING_SOURCES}, and {@link collectPending} runs each
 * one *fail-open*: a source that throws (a corrupt `questions.json`, say) contributes
 * nothing and never breaks the others, because "the notice broke" is a strictly worse
 * outcome than "the notice under-counted for one turn." Fail-open stops short of lying,
 * though: {@link collectPendingWithFailures} names the sources that threw, and
 * {@link pendingNotice} stays silent rather than reporting `'pending: clear'` when the
 * only reason the set looks empty is that nothing could be read.
 *
 * `pending.enabled=false` turns the whole facility off: {@link pendingNotice} returns
 * `null` and stores nothing, leaving no trace that it ever ran. When the pending set
 * empties out and the session was last told about a non-empty one, the notice reads
 * `'pending: clear'` exactly once — so a session that had a backlog learns it was taken
 * by someone else, rather than the backlog simply going quiet with no explanation.
 *
 * @see ./desk_questions.js
 * @see ./messages.js
 * @see ./config.js
 * @see ./store.js
 */

import { effectiveValue }               from './config.js';
import { openIntents, readQuestions }   from './desk_questions.js';
import { unreadRows }                   from './messages.js';
import type { Store }                   from './store.js';

/** Longest a pending item's label may run before it is cut, in characters. */
const LABEL_MAX = 60;

/**
 * The environment a pending source may consult — the same injectable shape every other
 * env-reading function in this codebase accepts, so a source can be tested without
 * touching the real process environment. No source reads it today; it rides the
 * interface for the sources issue #98 leaves for later.
 */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * One thing waiting on a session: a desk request nobody has claimed, or an unread
 * self-addressed message.
 */
export interface PendingItem {
  /** Which source produced this item. */
  readonly kind  : 'message' | 'desk_intent';
  /** Stable identity within `kind` — a message id, or a desk question id. */
  readonly key   : string;
  /** Short human-readable description, at most {@link LABEL_MAX} characters. */
  readonly label : string;
  /** ISO instant the item started waiting — a message's `ts_utc`, a desk row's queue moment. */
  readonly since : string;
}

/**
 * One feed into the pending set: a kind, and how to collect its current items.
 *
 * A registry entry rather than a bare function so a future source can carry more than a
 * closure if it ever needs to (a display name, a config key it gates on) without
 * reshaping {@link PENDING_SOURCES} or its callers.
 */
export interface PendingSource {
  readonly kind: PendingItem['kind'];
  /**
   * The source's current items for one session.
   *
   * @param now the instant to evaluate against — never read from the system clock, so a
   *            caller can pin the whole collection to one instant
   * @param env the process environment, for a source that ever needs it
   * @returns the open items this source sees right now; `[]` when there are none
   */
  collect(store: Store, session: string, now: Date, env: Env): PendingItem[];
}

/** Cut a label to {@link LABEL_MAX} characters — a notice line, not the full text. */
function truncateLabel(text: string): string {
  return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX) : text;
}

/**
 * The desk source: every open (queued, unclaimed, undismissed) desk question, from
 * `desk.path`'s `questions.json`.
 *
 * `desk.path` unset yields no items — there is nothing to read, and that is not an
 * error. A *present* `desk.path` whose `questions.json` fails to parse propagates the
 * throw from {@link readQuestions}; {@link collectPending} is what catches it, so this
 * source stays a straightforward read with no error handling of its own.
 */
const deskSource: PendingSource = {
  kind: 'desk_intent',
  collect(store): PendingItem[] {

    const path = effectiveValue(store, 'desk.path');
    if (path === null) { return []; }

    return openIntents(readQuestions(path)).map((row): PendingItem => ({
      kind  : 'desk_intent',
      key   : row.id,
      label : truncateLabel(row.text),
      since : row.queuedAt ?? row.asked,
    }));

  },
};

/**
 * The message source: unread `self` messages for the session, gated on
 * `messages.enabled` — the messagebox's own kill switch.
 *
 * Reads through {@link unreadRows}, which peeks without receipting: the pending check is
 * a background glance, and receipting here would silently consume mail the session never
 * actually read.
 */
const messageSource: PendingSource = {
  kind: 'message',
  collect(store, session, now): PendingItem[] {

    if (effectiveValue(store, 'messages.enabled') === 'false') { return []; }

    return unreadRows(store, session, now).map((row): PendingItem => {
      const text = row['text'];
      return {
        kind  : 'message',
        key   : String(row['id']),
        label : truncateLabel(typeof text === 'string' ? text : ''),
        since : String(row['ts_utc']),
      };
    });

  },
};

/** Every registered pending source, in the order their items appear when tied. */
export const PENDING_SOURCES: readonly PendingSource[] = [deskSource, messageSource];

/**
 * The result of one collection pass: what was found, and which sources could not be read.
 *
 * `failed` is what separates "the queue is empty" from "I could not see the queue" — an
 * empty `items` with a non-empty `failed` means ignorance, not an empty queue, and a
 * caller that treats the two alike will eventually tell a session its backlog is clear
 * while the backlog sits there unclaimed.
 */
export interface PendingCollection {
  /** Every item every readable source returned, in {@link PENDING_SOURCES} order. */
  readonly items  : PendingItem[];
  /** The `kind` of each source whose read threw, in the same order; `[]` when all read cleanly. */
  readonly failed : PendingItem['kind'][];
}

/**
 * Every pending item across every source, plus the sources that could not be read at all.
 *
 * Each source runs independently and **fails open**: a source that throws (a corrupt
 * `questions.json`, an unreadable store row) contributes nothing and never stops the
 * remaining sources from running — a notice that under-counts by one source for a turn is
 * a far smaller cost than a notice that breaks outright. What it must never do is let the
 * under-count *pass for a fact*, so the throw is recorded in `failed` rather than
 * swallowed whole: {@link pendingNotice} reads it to decide whether an empty set is
 * genuinely empty or merely unreadable.
 *
 * @param now the instant to evaluate every source against
 * @param env the process environment, threaded to sources that read it
 * @returns the items found, and the kinds of the sources that threw
 *
 * @example
 *   collectPendingWithFailures(store, 'sess-1', new Date())
 *   // => { items: [{ kind: 'desk_intent', key: 'q1', since: '…' }], failed: [] }
 *
 * @example
 *   // desk.path points at a truncated questions.json, one message unread
 *   collectPendingWithFailures(store, 'sess-1', new Date())
 *   // => { items: [{ kind: 'message', key: '5', since: '…' }], failed: ['desk_intent'] }
 *
 * @see collectPending
 * @see PENDING_SOURCES
 */
export function collectPendingWithFailures(
  store   : Store,
  session : string,
  now     : Date,
  env     : Env = process.env,
): PendingCollection {

  const items  : PendingItem[]          = [],
        failed : PendingItem['kind'][]  = [];

  for (const source of PENDING_SOURCES) {
    try {
      items.push(...source.collect(store, session, now, env));
    } catch {
      // Fail-open per source (module docblock): this source contributes nothing, and the
      // loop continues to the next one rather than aborting the whole collection — but
      // the failure is named, so an empty result is never mistaken for an empty queue.
      failed.push(source.kind);
    }
  }

  return { items, failed };

}

/**
 * Every pending item across every source, for one session at one instant.
 *
 * The plain view of {@link collectPendingWithFailures}, for the callers that only need a
 * count and are content to under-count when a source is unreadable — a source that throws
 * contributes nothing and never stops the others from running.
 *
 * @param now the instant to evaluate every source against
 * @param env the process environment, threaded to sources that read it
 *
 * @example
 *   collectPending(store, 'sess-1', new Date())
 *   // => [{ kind: 'desk_intent', key: 'q1', since: '2026-08-30T08:05:00.000Z' }]
 *
 * @see collectPendingWithFailures
 * @see PENDING_SOURCES
 */
export function collectPending(
  store   : Store,
  session : string,
  now     : Date,
  env     : Env = process.env,
): PendingItem[] {
  return collectPendingWithFailures(store, session, now, env).items;
}

/**
 * How many whole `nagHours` intervals have elapsed since `since`, as of `now`.
 *
 * Never negative: a `since` that is in the future — clock skew, or a bad row — reads as
 * "just started waiting" rather than propagating a negative count into the fingerprint.
 *
 * @param since   ISO instant the item started waiting
 * @param now     the instant to measure against
 * @param nagHours hours per interval; the effective `pending.nag_hours`
 * @returns the whole number of intervals elapsed, `0` at minimum
 *
 * @example
 *   nagEpoch('2026-08-30T00:00:00Z', new Date('2026-08-30T04:00:00Z'), 4)  // => 1
 *   nagEpoch('2026-08-30T00:00:00Z', new Date('2026-08-30T03:59:00Z'), 4)  // => 0
 */
export function nagEpoch(since: string, now: Date, nagHours: number): number {
  const elapsedHours = (now.getTime() - Date.parse(since)) / 3_600_000;
  return elapsedHours <= 0 ? 0 : Math.floor(elapsedHours / nagHours);
}

/**
 * A stable, order-independent summary of the pending set: what is waiting, and how many
 * nag intervals each item has crossed.
 *
 * Two calls with the same items in different order produce the same fingerprint —
 * sorted before joining — because the pending set is a set, not a sequence, and
 * {@link pendingNotice} must not re-announce it merely because two sources returned
 * their items in a different order this turn. Empty for no items, so a fresh session and
 * a just-cleared backlog fingerprint identically.
 *
 * @param now      the instant every item's nag epoch is measured against
 * @param nagHours hours per nag interval; the effective `pending.nag_hours`
 *
 * @example
 *   fingerprint([{ kind: 'message', key: '5', label: 'x', since: '…' }], new Date(), 4)
 *   // => 'message:5@0'
 *   fingerprint([], new Date(), 4)  // => ''
 *
 * @see nagEpoch
 */
export function fingerprint(items: readonly PendingItem[], now: Date, nagHours: number): string {
  return items
    .map(item => `${item.kind}:${item.key}@${String(nagEpoch(item.since, now, nagHours))}`)
    .sort()
    .join('|');
}

/**
 * Render a non-empty pending set as the notice line's body: counts by kind, naming the
 * tool that acts on them.
 *
 * Always names `desk request`s before `unread message`s, regardless of the input order —
 * the fingerprint may be order-independent, but the rendered line reads the same way
 * every time it appears. Callers with an empty set render `'pending: clear'` themselves
 * ({@link pendingNotice}); this function assumes at least one item.
 *
 * @example
 *   describePending([
 *     { kind: 'message', key: '1', label: 'x', since: 'S' },
 *     { kind: 'desk_intent', key: 'q1', label: 'x', since: 'S' },
 *     { kind: 'desk_intent', key: 'q2', label: 'x', since: 'S' },
 *   ])
 *   // => 'pending: 2 desk requests, 1 unread message (self-expression claim_pending)'
 */
export function describePending(items: readonly PendingItem[]): string {

  const deskCount = items.filter(item => item.kind === 'desk_intent').length,
        msgCount  = items.filter(item => item.kind === 'message').length,
        parts: string[] = [];

  if (deskCount > 0) { parts.push(`${String(deskCount)} desk request${deskCount === 1 ? '' : 's'}`); }
  if (msgCount  > 0) { parts.push(`${String(msgCount)} unread message${msgCount === 1 ? '' : 's'}`); }

  return `pending: ${parts.join(', ')} (self-expression claim_pending)`;

}

/**
 * The fingerprint a session was last told about, or `null` when none was ever recorded.
 *
 * @example
 *   lastFingerprint(store, 'sess-1')  // => null on a fresh session
 *
 * @see rememberFingerprint
 */
export function lastFingerprint(store: Store, session: string): string | null {
  const row = store.db.prepare('SELECT fingerprint FROM pending_notice WHERE session = ?').get(session);
  return row ? String(row['fingerprint']) : null;
}

/**
 * Record the fingerprint a session was just told about, replacing whatever was there.
 *
 * One row per session (the table's primary key) — there is no history to keep, because a
 * superseded fingerprint is simply overwritten.
 *
 * @param fp  the fingerprint just surfaced, from {@link fingerprint}
 * @param now the moment it was recorded
 *
 * @example
 *   rememberFingerprint(store, 'sess-1', 'message:5@0', new Date());
 *
 * @see lastFingerprint
 */
export function rememberFingerprint(store: Store, session: string, fp: string, now: Date): void {
  store.db.prepare(
    'INSERT INTO pending_notice (session, fingerprint, ts_utc) VALUES (?,?,?) ' +
    'ON CONFLICT(session) DO UPDATE SET fingerprint = excluded.fingerprint, ts_utc = excluded.ts_utc'
  ).run(session, fp, now.toISOString());
}

/**
 * The pending notice for one session at one instant — or `null` when there is nothing
 * new to say.
 *
 * Reads the effective `pending.enabled` and `pending.nag_hours`, collects every source,
 * fingerprints the result, and compares it against what this session was last told. A
 * matching fingerprint is silence; a changed one is spoken and remembered. An empty
 * pending set renders `'pending: clear'` when the previous fingerprint was non-empty —
 * so a session that had a backlog learns it emptied, once — and stays silent thereafter,
 * because `''` then equals `''` on every later call until something pends again.
 *
 * An empty set reached only because every source that could have spoken *threw* is not
 * an empty queue, and is never reported as one: nothing is said and nothing is stored,
 * so the remembered fingerprint survives untouched and the next readable pass decides.
 *
 * `pending.enabled=false` short-circuits before any of that: `null` is returned and
 * nothing is written, so disabling the facility leaves no residue in `pending_notice`.
 *
 * @param now injectable clock; defaults to now
 * @param env the process environment, threaded to {@link collectPendingWithFailures}'s sources
 *
 * @example
 *   pendingNotice(store, 'sess-1', new Date())
 *   // => 'pending: 1 desk request (self-expression claim_pending)'  — first time it appears
 *   pendingNotice(store, 'sess-1', new Date())
 *   // => null  — unchanged since the last call
 *
 * @see collectPendingWithFailures
 * @see fingerprint
 */
export function pendingNotice(
  store   : Store,
  session : string,
  now     : Date = new Date(),
  env     : Env  = process.env,
): string | null {

  if (effectiveValue(store, 'pending.enabled') !== 'true') { return null; }

  const nag       = Number(effectiveValue(store, 'pending.nag_hours')),
        collected = collectPendingWithFailures(store, session, now, env),
        items     = collected.items,
        fp        = fingerprint(items, now, nag),
        last      = lastFingerprint(store, session);

  // Nothing found, but a source could not be read: that is ignorance, not an empty queue.
  // Speaking here would claim `pending: clear` over a backlog that is still sitting
  // there, and storing `''` would make the lie stick until the set changed again. Say
  // nothing, store nothing, and let the next healthy read be the one that decides.
  if (items.length === 0 && collected.failed.length > 0) { return null; }

  if (fp === (last ?? '')) { return null; }

  rememberFingerprint(store, session, fp, now);

  return items.length === 0 ? 'pending: clear' : describePending(items);

}
