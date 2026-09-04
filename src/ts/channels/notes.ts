/**
 * Held notes: self-initiated speech with delivery semantics (issue #43).
 *
 * The whole facility rests on one asymmetry. An autonomous wakeup is a perfectly good
 * moment to **decide** something is worth saying and to **write it down**; it is a
 * provably terrible moment to **say** it, because nobody is watching an unattended
 * terminal and the assistant would be left believing it communicated something the
 * human never saw. A `UserPromptSubmit` turn is the opposite: it is the one moment in
 * the stack with a presence guarantee, because a human definitionally just acted. So:
 *
 * > **Compose on any turn; deliver only on a human's turn.**
 *
 * A note is stored as a **sidecar on an existing messagebox row** (#41) rather than in
 * a rival store: the words, the audience, the sender identity, and the expiry live on
 * `messages`, and `notes` adds only `not_before`, `reason`, and `series_key`. The
 * delivery ladder lives in the append-only `note_events` ledger, whose `turn` column
 * carries the hook-supplied turn type — which is what makes the rule structural rather
 * than aspirational. There is no `read` state and no path to `surfaced` that a hook did
 * not authorize, so a false belief about delivery is *inexpressible* rather than merely
 * discouraged.
 *
 * Every failure mode the design forecloses is foreclosed here, mechanically:
 *
 * - **Nagging** — per-turn budget, rolling-24-hour cap, offer cap after which a note
 *   dies, mandatory TTL, no resurrection, and `series_key` dedupe.
 * - **Performing** — a mandatory stated `reason` plus a queryable queue, so a pattern
 *   of empty notes is visible as data. Nothing anywhere prompts "consider writing a
 *   note": a prompted note is a performed note.
 * - **Manipulating** — mandatory provenance on every surfaced note, so a timing choice
 *   is always visible and always attributable.
 * - **False belief of delivery** — the ladder's vocabulary itself; see
 *   {@link ../channels/vocabulary.js NOTE_STATES}.
 * - **Groundhog-day resends** — `series_key` supersede plus the permanent ledger.
 * - **Cross-host drift** — on a host with no `UserPromptSubmit` hook, notes compose and
 *   queue but no offer ever fires, so nothing is ever marked surfaced there. Degraded
 *   means "held longer", never "claimed delivered".
 *
 * @see ./vocabulary.js NOTE_STATES
 * @see ./messages.js
 * @see ../mcp/note_tools.js
 * @see ../mcp/hooks.js
 */

import { NOTE_STATES, isMember } from './vocabulary.js';
import type { NoteState, NoteEvent, Turn } from './vocabulary.js';
import { stamp, dayPhrase }    from './time.js';
import { effectiveValue }      from './config.js';
import { postMessage, validateMessage } from './messages.js';
import { hookObservedTurn }    from './context.js';
import type { Store }          from './store.js';

/** Config key gating the whole facility; only an effective `'true'` enables it. */
export const MAILBOX_ENABLED_KEY = 'mailbox.enabled';

/**
 * The longest stated reason accepted, in characters.
 *
 * Short on purpose. The reason exists so a note's *cost* is visible in the audit — "why
 * was this worth holding?" answered in one clause — not so a second note can be smuggled
 * into the metadata of the first.
 */
export const NOTE_REASON_MAX = 200;

/** Milliseconds in one day, for TTL arithmetic. */
const DAY_MS = 86_400_000;

/**
 * The note lifetime, in days, that applies when nobody configured one and nobody supplied
 * an explicit `expiresUtc`.
 *
 * A named constant rather than a literal because two callers need the same number for the
 * same note: {@link noteBudgets} resolves it for the write, and {@link validateNote}
 * needs it to judge a `notBefore` against the expiry the note is *actually going to get*.
 * A second literal there is how "queued but already doomed" got through the first time.
 */
export const DEFAULT_TTL_DAYS = 14;

/** The rolling window `mailbox.daily_cap` is measured over, in milliseconds. */
const CAP_WINDOW_MS = DAY_MS;

/**
 * The numeric budgets in force, all read through the tolerant effective-value accessor
 * so a hand-edited or out-of-range row behaves as unset rather than as a limit nobody
 * chose.
 *
 * @see noteBudgets
 */
export interface NoteBudgets {
  /** Held notes one reply turn may be offered. */
  readonly surfaceBudget  : number;
  /** Held notes that may be surfaced in any rolling 24 hours. */
  readonly dailyCap       : number;
  /** Queue depth; composing past it fails loudly. */
  readonly maxPending     : number;
  /** Offers a note gets before it expires unsurfaced. */
  readonly offerCap       : number;
  /** Default note lifetime, in days, when no expiry is supplied. */
  readonly defaultTtlDays : number;
}

/** What a caller supplies when composing a note. */
export interface NoteInput {
  /** The words the human will eventually read. */
  readonly text        : string;
  /** Why this was worth holding; mandatory, and part of the audit surface. */
  readonly reason      : string;
  /** The composing session, usually adopted from `turn_context` at the tool layer. */
  readonly session     : string;
  /** ISO instant before which the note is never offered; defaults to now. */
  readonly notBefore?  : string | undefined;
  /** ISO instant after which the note dies unheard; defaults to now + the TTL. */
  readonly expiresUtc? : string | undefined;
  /** Dedupe handle: at most one live note per series, later replacing earlier. */
  readonly seriesKey?  : string | undefined;
  readonly promptId?   : string | undefined;
  /** The hook-observed turn type of the composing moment; recorded, never enforced. */
  readonly turn?       : Turn | undefined;
  readonly agentId?    : string | undefined;
  readonly agentType?  : string | undefined;
}

/** One note as the rest of the system sees it: stored facts plus derived state. */
export interface NoteView {
  readonly id           : number;
  readonly messageId    : number;
  /** The backing message's uuid — the note's stable cross-host identity. */
  readonly uuid         : string;
  readonly text         : string;
  readonly reason       : string;
  readonly seriesKey    : string | null;
  readonly notBefore    : string;
  readonly expiresUtc   : string;
  /** When the note was composed, in UTC. */
  readonly writtenUtc   : string;
  /** When the note was composed, rendered locally — the provenance line's clock. */
  readonly writtenLocal : string;
  readonly session      : string;
  readonly offerCount   : number;
  readonly state        : NoteState;
}

/**
 * The turn a note operation happens on, as the hook observed it.
 *
 * `turn` is not a preference: {@link offerRipeNotes} refuses anything but `'reply'`, and
 * `promptId` is what a later {@link surfaceNote} must match. A turn with no prompt
 * identity cannot authorize anything, because there would be nothing to match against.
 */
export interface NoteTurn {
  readonly turn      : Turn;
  readonly promptId  : string;
  readonly session?  : string | undefined;
}

/**
 * Who is acting, for operations a wakeup may legitimately perform.
 *
 * Distinct from {@link NoteTurn} precisely because these fields are *recorded* rather
 * than *enforced*: withdrawing is safe from any turn, so the ledger notes what it saw
 * and asks nothing. Only the delivery path demands a proven `reply` turn.
 */
export interface NoteActor {
  readonly turn?     : Turn | undefined;
  readonly promptId? : string | undefined;
  readonly session?  : string | undefined;
}

/** What {@link composeNote} returns: the new note, and whatever it replaced. */
export interface ComposedNote {
  readonly id         : number;
  readonly messageId  : number;
  readonly uuid       : string;
  /** Id of the note this superseded through `series_key` dedupe, or `null`. */
  readonly superseded : number | null;
}

/**
 * Whether the held-note facility is switched on.
 *
 * Default **off**, and only an effective `'true'` enables — the same inverse posture
 * `share.enabled` takes, and for the same reason: this is a consent surface, so an
 * ambiguous value must mean no. Until a human says yes, no note is composed and no
 * mailbox line is injected.
 *
 * @example
 *   mailboxEnabled(store)   // => false on a fresh install
 *   writeConfig(store, 'mailbox.enabled', 'true');
 *   mailboxEnabled(store)   // => true
 */
export function mailboxEnabled(store: Store): boolean {
  return effectiveValue(store, MAILBOX_ENABLED_KEY) === 'true';
}

/** One integer budget, read tolerantly, falling back to `fallback` when unusable. */
function budget(store: Store, key: string, fallback: number): number {
  const raw    = effectiveValue(store, key),
        parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Every budget in force, resolved once so one turn's decisions are made against one
 * consistent set of numbers.
 *
 * @example
 *   noteBudgets(store)
 *   // => { surfaceBudget: 1, dailyCap: 3, maxPending: 10, offerCap: 3, defaultTtlDays: 14 }
 *
 * @see ./config.js CONFIG_KEYS
 */
export function noteBudgets(store: Store): NoteBudgets {
  return {
    surfaceBudget  : budget(store, 'mailbox.surface_budget',   1),
    dailyCap       : budget(store, 'mailbox.daily_cap',        3),
    maxPending     : budget(store, 'mailbox.max_pending',     10),
    offerCap       : Math.max(budget(store, 'mailbox.offer_cap', 3), 1),
    defaultTtlDays : Math.max(budget(store, 'mailbox.default_ttl_days', DEFAULT_TTL_DAYS), 1),
  };
}

/** The events that end a note's life; reaching one is terminal and irreversible. */
const TERMINAL_EVENTS = "('surfaced','withdrawn','expired')";

/**
 * The joined note/message projection every read shares, with the ledger facts a state
 * derivation needs computed alongside.
 *
 * One select rather than several because state is a function of the whole ledger: a
 * query that fetched rows and then asked per-note follow-ups would be both slower and
 * able to observe a half-updated ledger between statements.
 */
const NOTE_SELECT = `
  SELECT n.id, n.message_id, n.reason, n.series_key, n.not_before,
         m.uuid, m.text, m.expires_utc, m.ts_utc, m.ts_local, m.session,
         (SELECT COUNT(*) FROM note_events e
           WHERE e.note_id = n.id AND e.event = 'offered')            AS offer_count,
         (SELECT e.event FROM note_events e
           WHERE e.note_id = n.id ORDER BY e.id DESC LIMIT 1)         AS last_event,
         (SELECT e.event FROM note_events e
           WHERE e.note_id = n.id AND e.event IN ${TERMINAL_EVENTS}
           ORDER BY e.id ASC LIMIT 1)                                 AS terminal_event,
         (SELECT e.prompt_id FROM note_events e
           WHERE e.note_id = n.id AND e.event = 'offered'
           ORDER BY e.id DESC LIMIT 1)                                AS last_offer_prompt,
         (SELECT e.turn FROM note_events e
           WHERE e.note_id = n.id AND e.event = 'offered'
           ORDER BY e.id DESC LIMIT 1)                                AS last_offer_turn,
         -- An offer's identity is the *pair* (session, prompt_id), never the prompt id
         -- alone: prompt ids reach the model through ordinary reads, so a bare id is a
         -- quotable token rather than a proof. Carried beside the other two so a single
         -- read answers the whole authorisation question. See surfaceNote.
         (SELECT e.session FROM note_events e
           WHERE e.note_id = n.id AND e.event = 'offered'
           ORDER BY e.id DESC LIMIT 1)                                AS last_offer_session
    FROM notes n JOIN messages m ON m.id = n.message_id`;

/** The ledger facts a state derivation reads, isolated so the rule can be pure. */
export interface NoteFacts {
  /** The first terminal event recorded, or `null` while the note is still live. */
  readonly terminalEvent : NoteEvent | null;
  /** The most recent event of any kind, or `null` — which cannot happen in practice. */
  readonly lastEvent     : NoteEvent | null;
  /** How many times the note has been offered. */
  readonly offerCount    : number;
  /** The mandatory expiry, as an ISO instant. */
  readonly expiresUtc    : string;
}

/**
 * The one rule that turns a ledger into a state — pure, so it can be property-tested
 * without a database.
 *
 * Order matters and encodes the design's priorities: a recorded terminal event is the
 * last word (a withdrawn note stays withdrawn even after its TTL would have expired it),
 * then the mandatory TTL, then the transient offer, then death by exhausted offers, then
 * the resting state.
 *
 * **The offer outranks the offer cap**, and that ordering is load-bearing rather than
 * incidental. The cap counts *chances at an entrance*, and the final chance is a chance:
 * a note offered for the third time under `offer_cap 3` was genuinely put in front of the
 * model this turn, the hook said so on the record, and refusing to let it be surfaced
 * would mean rendering text into a reply and then being unable to say so — the record
 * claiming *less* than happened, which is the same class of lie as claiming more. Ranking
 * the count first also made `offer_cap 1` — a legal setting, and the one a minimalist
 * would pick — surface nothing at all, ever. Expiry by count therefore lands one turn
 * later, when {@link lapseStaleOffers} lapses that final offer and the note stops being
 * outstanding.
 *
 * @param facts   the ledger facts for one note
 * @param offerCap how many offers a note gets before it dies unsurfaced
 * @param nowUtc  the instant to evaluate expiry against, as an ISO string
 *
 * @example
 *   deriveNoteState({ terminalEvent: null, lastEvent: 'composed', offerCount: 0,
 *                     expiresUtc: '2099-01-01T00:00:00.000Z' }, 3, '2026-08-28T00:00:00.000Z')
 *   // => 'queued'
 *
 * @example
 *   deriveNoteState({ terminalEvent: null, lastEvent: 'declined', offerCount: 3,
 *                     expiresUtc: '2099-01-01T00:00:00.000Z' }, 3, '2026-08-28T00:00:00.000Z')
 *   // => 'expired' — the offer cap is a real ceiling, not an intention
 *
 * @example
 *   deriveNoteState({ terminalEvent: null, lastEvent: 'offered', offerCount: 3,
 *                     expiresUtc: '2099-01-01T00:00:00.000Z' }, 3, '2026-08-28T00:00:00.000Z')
 *   // => 'offered' — the last chance is still a chance, until it lapses
 *
 * @see ./vocabulary.js NOTE_STATES
 */
export function deriveNoteState(facts: NoteFacts, offerCap: number, nowUtc: string): NoteState {

  if (facts.terminalEvent !== null && isMember(NOTE_STATES, facts.terminalEvent)) {
    return facts.terminalEvent;
  }

  if (nowUtc > facts.expiresUtc)      { return 'expired'; }
  if (facts.lastEvent === 'offered')  { return 'offered'; }
  if (facts.offerCount >= offerCap)   { return 'expired'; }

  return 'queued';

}

/** Turn one joined row into a {@link NoteView}, deriving the state as it goes. */
function toView(row: Record<string, unknown>, offerCap: number, nowUtc: string): NoteView {

  const rawExpires = row['expires_utc'],
        // Nullable on `messages` in general, and mandatory for notes: an empty string
        // here would mean a hand-edited row, and it reads as "already expired", which is
        // the safe direction — a broken note is held back rather than delivered.
        expiresUtc = typeof rawExpires === 'string' ? rawExpires : '',
        offerCount = Number(row['offer_count'] ?? 0),
        terminal   = row['terminal_event'],
        last       = row['last_event'];

  return {
    id           : Number(row['id']),
    messageId    : Number(row['message_id']),
    uuid         : String(row['uuid']),
    text         : String(row['text']),
    reason       : String(row['reason']),
    seriesKey    : typeof row['series_key'] === 'string' ? row['series_key'] : null,
    notBefore    : String(row['not_before']),
    expiresUtc,
    writtenUtc   : String(row['ts_utc']),
    writtenLocal : String(row['ts_local']),
    session      : String(row['session']),
    offerCount,
    state        : deriveNoteState({
      terminalEvent : typeof terminal === 'string' ? terminal as NoteEvent : null,
      lastEvent     : typeof last     === 'string' ? last     as NoteEvent : null,
      offerCount,
      expiresUtc,
    }, offerCap, nowUtc),
  };

}

/** Append one ledger row. The only way any state ever changes. */
function record(
  store : Store,
  noteId: number,
  event : NoteEvent,
  turn  : NoteActor,
  when  : Date,
): void {
  store.db.prepare(
    'INSERT INTO note_events (note_id, ts_utc, event, turn, prompt_id, session) VALUES (?,?,?,?,?,?)')
    .run(noteId, stamp(when).utc, event,
         turn.turn ?? null, turn.promptId ?? null, turn.session ?? null);
}

/** The instants a note's window actually resolves to, defaults applied. */
export interface NoteWindow {
  /** The instant the note first becomes offerable, defaulted to `when`. */
  readonly notBefore  : string;
  /** The instant the note dies, defaulted to `when` plus the TTL. */
  readonly expiresUtc : string;
  /** Whether the expiry above is the default rather than a supplied one. */
  readonly defaulted  : boolean;
}

/**
 * The two instants a note actually gets, with both defaults already applied — the single
 * answer {@link validateNote} judges and {@link composeNote} writes.
 *
 * One function because the bug it forecloses was two: validation looked at the *supplied*
 * expiry and composition computed the *effective* one afterwards, so a `notBefore` past
 * the default TTL passed every check and was queued already dead. A note's window has one
 * definition or it has none.
 *
 * Unparseable input is treated as absent here, so this can run before validation without
 * throwing; `validateNote` reports the parse failure separately.
 *
 * @param defaultTtlDays the configured lifetime applied when no `expiresUtc` was supplied
 *
 * @example
 *   noteWindow({ text: 't', reason: 'r', session: 's1', notBefore: '2027-01-01T00:00:00Z' },
 *              new Date('2026-08-28T12:00:00Z'), 14)
 *   // => { notBefore: '2027-01-01…', expiresUtc: '2026-09-11…', defaulted: true }
 *   //    — ripens long after it dies, which is what validation now catches
 */
function noteWindow(input: NoteInput, when: Date, defaultTtlDays: number): NoteWindow {

  const instant = (value: string | undefined): Date | null => {
          if (value === undefined) { return null; }
          const at = new Date(value);
          return Number.isNaN(at.getTime()) ? null : at;
        },
        ripens  = instant(input.notBefore),
        dies    = instant(input.expiresUtc);

  return {
    notBefore  : (ripens ?? when).toISOString(),
    expiresUtc : (dies ?? new Date(when.getTime() + defaultTtlDays * DAY_MS)).toISOString(),
    defaulted  : dies === null,
  };

}

/**
 * Check a proposed note against the facility's rules, returning every problem found
 * rather than throwing on the first — a caller supplying two bad values learns about
 * both in one round trip.
 *
 * The queue-depth rule needs the store, so it lives in {@link composeNote}.
 *
 * The ripeness-versus-expiry rule is judged against the note's **effective** window (see
 * {@link noteWindow}), not against what the caller happened to type. `notBefore` a year
 * out with no `expiresUtc` is exactly as doomed as one paired with a near expiry, and the
 * caller who supplied neither expiry is the one least likely to spot it.
 *
 * @param input          the proposed note
 * @param when           the clock the defaults are computed against
 * @param defaultTtlDays the lifetime a defaulted expiry gets, so the check judges the
 *                       expiry the note will really have; defaults to
 *                       {@link DEFAULT_TTL_DAYS} for callers with no store in hand
 *
 * @example
 *   validateNote({ text: 'run reconcile first', reason: 'the deploy window opens then',
 *                  session: 's1' }, new Date())   // => []
 *
 * @example
 *   validateNote({ text: 'x', reason: '', session: 's1' }, new Date())
 *   // => ['reason must not be empty — a note with no stated reason is unauditable, …']
 *
 * @example
 *   validateNote({ text: 'x', reason: 'r', session: 's1', notBefore: '2027-01-01T00:00:00Z' },
 *                 new Date('2026-08-28T12:00:00Z'), 14)
 *   // => ['expiresUtc … must be after notBefore … could never be offered …']
 */
export function validateNote(
  input          : NoteInput,
  when           : Date   = new Date(),
  defaultTtlDays : number = DEFAULT_TTL_DAYS,
): string[] {

  // The text, session, and expiry rules are the messagebox's own — a note *is* a
  // message — so they are borrowed rather than restated, and cannot drift from it.
  const problems = validateMessage({
    audience   : 'user',
    text       : input.text,
    session    : input.session,
    expiresUtc : input.expiresUtc,
  });

  if (input.reason.trim() === '') {
    problems.push(
      'reason must not be empty — a note with no stated reason is unauditable, and ' +
      'making each note state its cost is what keeps the queue from filling with performance');
  }

  if (input.reason.length > NOTE_REASON_MAX) {
    problems.push(
      `reason must be at most ${String(NOTE_REASON_MAX)} characters ` +
      `(received ${String(input.reason.length)}) — it is a clause, not a second note`);
  }

  if (input.seriesKey?.trim() === '') {
    problems.push('seriesKey must not be blank when supplied');
  }

  if (input.notBefore !== undefined && Number.isNaN(Date.parse(input.notBefore))) {
    problems.push(`notBefore must parse as an ISO instant; received '${input.notBefore}'`);
  }

  const window = noteWindow(input, when, defaultTtlDays);

  if (window.expiresUtc <= window.notBefore) {
    problems.push(
      `expiresUtc ('${window.expiresUtc}') must be after notBefore ('${window.notBefore}') — ` +
      'a note that dies before it ripens could never be offered, and silently queueing one ' +
      'would be the false-belief-of-delivery failure in a new costume' +
      (window.defaulted
        ? ` (no expiresUtc was supplied, so it defaulted to now plus the ${String(defaultTtlDays)}-` +
          'day TTL; give an explicit expiresUtc, or bring notBefore forward)'
        : ''));
  }

  return problems;

}

/**
 * How many notes one page of a state-filtered {@link listNotes} walk reads.
 *
 * Comfortably above the 200-note ceiling a single call can return, so the common case is
 * one round trip and the paging only ever costs anything on a store big enough to need it.
 */
const LIST_PAGE = 256;

/** The live-note predicate: no terminal event, not expired, offers not exhausted. */
const LIVE = `
  NOT EXISTS (SELECT 1 FROM note_events e
               WHERE e.note_id = n.id AND e.event IN ${TERMINAL_EVENTS})
  AND m.expires_utc > ?
  AND (SELECT COUNT(*) FROM note_events e WHERE e.note_id = n.id AND e.event = 'offered') < ?`;

/**
 * The notes still in play — `queued` or `offered` — oldest first.
 *
 * This is what `mailbox.max_pending` counts: expired, withdrawn, and surfaced notes are
 * history, and history is not a queue.
 *
 * @param when injectable clock for expiry evaluation
 *
 * @example
 *   pendingNotes(store).length   // => 0 on a fresh install
 *
 * @see noteBudgets
 */
export function pendingNotes(store: Store, when: Date = new Date()): NoteView[] {
  const budgets = noteBudgets(store),
        nowUtc  = when.toISOString();
  return store.db.prepare(`${NOTE_SELECT} WHERE ${LIVE} ORDER BY n.id ASC`)
    .all(nowUtc, budgets.offerCap)
    .map(row => toView(row, budgets.offerCap, nowUtc));
}

/**
 * The notes that are ripe *and* free to be offered: live, past their `not_before`, and
 * not already sitting on an outstanding offer.
 *
 * Ripeness is derived, never stored — a stored ripeness would go stale the moment a
 * clock moved.
 *
 * @param when injectable clock; a note is ripe when `when >= not_before`
 *
 * @example
 *   composeNote(store, { text: 'run reconcile', reason: 'deploy window',
 *                        session: 's1', notBefore: '2099-01-01T00:00:00Z' }, v);
 *   ripeNotes(store)   // => [] — not until 2099
 *
 * @see offerRipeNotes
 */
export function ripeNotes(store: Store, when: Date = new Date()): NoteView[] {

  const budgets = noteBudgets(store),
        nowUtc  = when.toISOString();

  return store.db.prepare(`
    ${NOTE_SELECT}
     WHERE ${LIVE}
       AND n.not_before <= ?
       AND COALESCE((SELECT e.event FROM note_events e
                      WHERE e.note_id = n.id ORDER BY e.id DESC LIMIT 1), 'composed') <> 'offered'
     ORDER BY n.id ASC`)
    .all(nowUtc, budgets.offerCap, nowUtc)
    .map(row => toView(row, budgets.offerCap, nowUtc));

}

/**
 * One note by id, with its state derived, or `null` when no such note exists.
 *
 * @example
 *   const note = composeNote(store, input, '0.2.1');
 *   noteView(store, note.id)?.state   // => 'queued'
 */
export function noteView(store: Store, noteId: number, when: Date = new Date()): NoteView | null {
  const budgets = noteBudgets(store),
        nowUtc  = when.toISOString(),
        row     = store.db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(noteId);
  return row === undefined ? null : toView(row, budgets.offerCap, nowUtc);
}

/**
 * Every note, newest first, with its state derived — the audit surface.
 *
 * Deliberately unfiltered by default. "A pattern of empty notes is visible as data
 * rather than deniable as vibes" only holds if the notes that *died* are as visible as
 * the ones that landed, so expired and withdrawn notes are listed too.
 *
 * A filtered listing walks the table in pages until it has `limit` matches or runs out
 * of notes. It cannot do the filtering in SQL, because state is derived from the ledger
 * and the clock rather than stored — that is the invariant keeping a stored state from
 * ever disagreeing with the events justifying it, and it is worth a paged walk. What it
 * is *not* worth is the previous shape: fetch the newest `limit * 4` rows, filter those,
 * and return whatever survived. With thirty notes and the five oldest withdrawn,
 * `{ state: 'withdrawn', limit: 5 }` returned nothing at all, and an audit surface that
 * quietly answers "none" is worse than one that is slow.
 *
 * @param limit most notes returned; default 20, capped at 200
 * @param state optional state filter; omit for everything
 *
 * @example
 *   listNotes(store, { state: 'expired' })   // the notes that never found their moment
 */
export function listNotes(
  store : Store,
  query : { readonly limit?: number | undefined; readonly state?: NoteState | undefined } = {},
  when  : Date = new Date(),
): NoteView[] {

  const budgets = noteBudgets(store),
        nowUtc  = when.toISOString(),
        limit   = Math.min(Math.max(query.limit ?? 20, 1), 200),
        page    = store.db.prepare(`${NOTE_SELECT} ORDER BY n.id DESC LIMIT ? OFFSET ?`);

  if (query.state === undefined) {
    return page.all(limit, 0).map(row => toView(row, budgets.offerCap, nowUtc));
  }

  const found: NoteView[] = [];

  for (let offset = 0; found.length < limit; offset += LIST_PAGE) {

    const rows = page.all(LIST_PAGE, offset);

    for (const row of rows) {
      const view = toView(row, budgets.offerCap, nowUtc);
      if (view.state === query.state) { found.push(view); }
      if (found.length === limit)     { return found; }
    }

    if (rows.length < LIST_PAGE) { break; }

  }

  return found;

}

/**
 * How many notes have been surfaced inside the rolling cap window ending at `when`.
 *
 * Rolling rather than calendar-day, matching the claudio budgets: a calendar day makes
 * midnight a free refill, which is exactly the wrong incentive for a scarcity mechanism.
 *
 * @example
 *   surfacedRecently(store)   // => 0 on a fresh install
 */
export function surfacedRecently(store: Store, when: Date = new Date()): number {
  const since = new Date(when.getTime() - CAP_WINDOW_MS).toISOString();
  return Number(store.db.prepare(
    "SELECT COUNT(*) AS n FROM note_events WHERE event = 'surfaced' AND ts_utc >= ?")
    .get(since)?.['n'] ?? 0);
}

/**
 * Compose one note: write it down now, to be offered no earlier than `notBefore`.
 *
 * Composition is unrestricted by turn type — wakeups, session-end reflection, and
 * ordinary mid-conversation turns may all compose — because writing is the safe half of
 * self-initiated speech. The composing turn's type is *recorded* on the ledger, so a
 * note written at 2 am says so; it is never *enforced*, because that would cost the
 * whole "something ripened while nobody was listening" use case for no safety gain.
 *
 * `series_key` dedupe runs here: a live note in the same series is withdrawn and named
 * in the result, so a second "remember the migration" note replaces the first rather
 * than joining it. That is the groundhog-day foreclosure.
 *
 * @param store         the open store to write into
 * @param input         the note
 * @param pluginVersion stamped onto the backing message row, as on every message
 * @param when          injectable clock; defaults and timestamps derive from it
 *
 * @example
 *   composeNote(store, { text: 'the migration in #52 assumes the store is v1',
 *                        reason: 'it matters only once the deploy window opens',
 *                        session: 's1', seriesKey: 'migration-52' }, '0.2.1')
 *   // => { id: 1, messageId: 1, uuid: '…', superseded: null }
 *
 * @throws {Error} If the facility is disabled — composing into a switched-off mailbox
 *                 would be exactly the silent-queue failure the design forbids.
 * @throws {Error} If validation fails, or the queue is already at `mailbox.max_pending`,
 *                 naming every problem. Failing loudly at the cap is deliberate: a
 *                 silently dropped note is a note the author believes was written.
 *
 * @see validateNote
 * @see withdrawNote
 */
export function composeNote(
  store         : Store,
  input         : NoteInput,
  pluginVersion : string,
  when          : Date = new Date(),
): ComposedNote {

  if (!mailboxEnabled(store)) {
    throw new Error(
      'cannot compose note:\n  - held notes are disabled ' +
      `(configure set ${MAILBOX_ENABLED_KEY} true); nothing was written`);
  }

  const budgets  = noteBudgets(store),
        problems = validateNote(input, when, budgets.defaultTtlDays);

  const pending = pendingNotes(store, when),
        // A note that would replace an existing one in its series does not grow the
        // queue, so it is not held against the cap — otherwise a full queue would make
        // *correcting* a queued note impossible, which is the opposite of the intent.
        replaces = input.seriesKey === undefined ? undefined
          : pending.find(note => note.seriesKey === input.seriesKey);

  if (replaces === undefined && pending.length >= budgets.maxPending) {
    problems.push(
      `the queue already holds ${String(pending.length)} pending note(s), at the limit of ` +
      `${String(budgets.maxPending)} (configure set mailbox.max_pending <n>) — withdraw ` +
      'something, or let the queue drain; nothing is ever queued silently past the cap');
  }

  if (problems.length > 0) {
    throw new Error(`cannot compose note:\n  - ${problems.join('\n  - ')}`);
  }

  // The same window validation just judged — one definition, so what was checked and what
  // is written cannot drift apart.
  const { notBefore, expiresUtc: expires } = noteWindow(input, when, budgets.defaultTtlDays);

  const ledger = { turn: input.turn, promptId: input.promptId, session: input.session };

  store.db.exec('BEGIN');

  try {

    if (replaces !== undefined) { record(store, replaces.id, 'withdrawn', ledger, when); }

    const message = postMessage(store, {
      audience   : 'user',
      text       : input.text,
      session    : input.session,
      expiresUtc : expires,
      promptId   : input.promptId,
      agentId    : input.agentId,
      agentType  : input.agentType,
    }, pluginVersion, when);

    store.db.prepare(
      'INSERT INTO notes (message_id, reason, series_key, not_before) VALUES (?,?,?,?)')
      .run(message.id, input.reason.trim(), input.seriesKey ?? null, notBefore);

    const id = Number(store.db.prepare('SELECT last_insert_rowid() AS id').get()?.['id'] ?? 0);

    record(store, id, 'composed', ledger, when);

    store.db.exec('COMMIT');

    return { id, messageId: message.id, uuid: message.uuid,
             superseded: replaces?.id ?? null };

  } catch (error) {

    store.db.exec('ROLLBACK');
    throw error;

  }

}

/**
 * Withdraw one note before it ever surfaces — the author's own exit.
 *
 * This matters because the composing turn and the surfacing turn may be separated by
 * days and by everything learned in between: a later, wiser turn must be able to retract
 * a note it no longer stands behind. Withdrawal is terminal; there is no un-withdraw,
 * because a note that could come back would be a note that can pester.
 *
 * @param noteId the note to retract
 * @param turn   the turn doing the retracting, recorded on the ledger
 * @param when   injectable clock
 * @returns the note's view as it stood *before* the withdrawal
 *
 * @example
 *   withdrawNote(store, 1, { turn: 'reply', promptId: 'p-9' }).state   // => 'queued'
 *   noteView(store, 1)?.state                                         // => 'withdrawn'
 *
 * @throws {Error} If no such note exists, or it has already reached a terminal state —
 *                 naming which, so "already surfaced" is never mistaken for success.
 */
export function withdrawNote(
  store  : Store,
  noteId : number,
  turn   : NoteActor = {},
  when   : Date = new Date(),
): NoteView {

  const view = noteView(store, noteId, when);

  if (view === null) {
    throw new Error(`cannot withdraw note:\n  - #${String(noteId)} does not exist`);
  }

  if (view.state === 'surfaced' || view.state === 'withdrawn' || view.state === 'expired') {
    throw new Error(
      `cannot withdraw note:\n  - #${String(noteId)} is already '${view.state}', which is ` +
      'terminal; a note that could come back would be a note that can pester');
  }

  record(store, noteId, 'withdrawn', turn, when);

  return view;

}

/**
 * Materialize `expired` events for every live note whose TTL has passed or whose offers
 * are exhausted, so the record says *when* a note died rather than only that it is dead.
 *
 * Bookkeeping, not policy: {@link deriveNoteState} already treats both conditions as
 * expiry, so a store that never sweeps behaves identically — it just cannot tell you the
 * moment. Called from the turn-start hook, where a bounded amount of work per prompt is
 * affordable and the sweep keeps the ripe query small.
 *
 * @returns how many notes were newly marked expired
 *
 * @example
 *   sweepExpired(store, new Date('2099-01-01T00:00:00Z'))   // => 2
 */
export function sweepExpired(store: Store, when: Date = new Date()): number {

  const budgets = noteBudgets(store),
        nowUtc  = when.toISOString();

  // Death by exhausted offers waits for the outstanding offer to lapse, exactly as
  // {@link deriveNoteState} does — otherwise the sweep would kill a note the hook put in
  // front of the model this very turn, and a store that swept would disagree with a store
  // that did not, which is the one thing this bookkeeping must never do.
  const doomed = store.db.prepare(`
    ${NOTE_SELECT}
     WHERE NOT EXISTS (SELECT 1 FROM note_events e
                        WHERE e.note_id = n.id AND e.event IN ${TERMINAL_EVENTS})
       AND (m.expires_utc <= ?
            OR ((SELECT COUNT(*) FROM note_events e
                  WHERE e.note_id = n.id AND e.event = 'offered') >= ?
                AND COALESCE((SELECT e.event FROM note_events e
                               WHERE e.note_id = n.id
                               ORDER BY e.id DESC LIMIT 1), 'composed') <> 'offered'))`)
    .all(nowUtc, budgets.offerCap);

  for (const row of doomed) { record(store, Number(row['id']), 'expired', {}, when); }

  return doomed.length;

}

/**
 * Lapse every outstanding offer that belongs to some *earlier* turn, recording it as
 * `declined` — the assistant had its chance and did not take it.
 *
 * This is what makes the offer cap a ceiling rather than a wish: an offer that is never
 * resolved would otherwise pin the note in `offered` forever, and a note that can never
 * expire is a note that can nag indefinitely.
 *
 * @param promptId the turn now in progress; its own outstanding offer is left alone
 * @returns how many offers lapsed
 *
 * @example
 *   lapseStaleOffers(store, 'p-2')   // => 1, if p-1 offered a note nobody surfaced
 */
export function lapseStaleOffers(store: Store, promptId: string, when: Date = new Date()): number {

  const stale = store.db.prepare(`
    ${NOTE_SELECT}
     WHERE NOT EXISTS (SELECT 1 FROM note_events e
                        WHERE e.note_id = n.id AND e.event IN ${TERMINAL_EVENTS})
       AND COALESCE((SELECT e.event FROM note_events e
                      WHERE e.note_id = n.id ORDER BY e.id DESC LIMIT 1), 'composed') = 'offered'`)
    .all()
    .filter(row => String(row['last_offer_prompt'] ?? '') !== promptId);

  for (const row of stale) { record(store, Number(row['id']), 'declined', {}, when); }

  return stale.length;

}

/**
 * The single delivery gate: offer up to the turn's allowance of ripe notes, and record
 * each offer as a mechanical fact against the hook-supplied turn type.
 *
 * **Refuses anything but a `reply` turn, unconditionally.** That single guard is what
 * makes "deliver only on a human's turn" structural: since `surfaced` requires a
 * matching `offered` row, and no `offered` row can exist outside a reply turn, there is
 * no sequence of operations — tool calls, wakeups, retries — that produces a delivery
 * claim the hook did not authorize. A turn with **neither** a `promptId` nor a `session`
 * is refused for the same reason: an offer's identity is that pair, so a turn missing
 * half of it leaves nothing for a later surfacing to match against — and an offer nobody
 * could ever surface is worse than no offer, because the model would render the words and
 * then be unable to say that it had.
 *
 * The allowance is `min(surface_budget, daily_cap - surfaced in the last 24 hours)`, so
 * an offer can never be made that the daily cap would have to refuse afterward.
 *
 * @param turn the hook-observed turn; `turn.turn` must be `'reply'`
 * @param when injectable clock
 * @returns the notes offered, in the order they should be surfaced; empty when the
 *          facility is off, the turn is not a reply, the turn carries no `promptId` or no
 *          `session`, nothing is ripe, or budget is spent
 *
 * @example
 *   offerRipeNotes(store, { turn: 'reply', promptId: 'p-1', session: 's1' })
 *   // => [ { id: 1, state: 'offered', … } ]
 *   offerRipeNotes(store, { turn: 'wakeup', promptId: 'p-1' })
 *   // => [] — always, whatever is ripe
 *
 * @see surfaceNote
 * @see ../mcp/hooks.js onUserPromptSubmit
 */
export function offerRipeNotes(store: Store, turn: NoteTurn, when: Date = new Date()): NoteView[] {

  if (!mailboxEnabled(store))  { return []; }
  if (turn.turn !== 'reply')   { return []; }
  if (turn.promptId === '')    { return []; }

  const session = turn.session ?? '';

  if (session === '') { return []; }

  const budgets = noteBudgets(store);

  lapseStaleOffers(store, turn.promptId, when);
  sweepExpired(store, when);

  const remaining = budgets.dailyCap - surfacedRecently(store, when),
        allowance = Math.min(budgets.surfaceBudget, Math.max(remaining, 0));

  if (allowance <= 0) { return []; }

  const offered = ripeNotes(store, when).slice(0, allowance);

  for (const note of offered) {
    record(store, note.id, 'offered',
           { turn: 'reply', promptId: turn.promptId, session }, when);
  }

  return offered.map(note => ({ ...note, state: 'offered' as const,
                                offerCount: note.offerCount + 1 }));

}

/**
 * Record that an offered note was rendered into this turn's reply — the terminal
 * success state, and the strongest claim the platform can evidence.
 *
 * Deliberately named `surfaced`, not `read` or `delivered`. Its exact meaning is "this
 * text was rendered into a reply the human explicitly prompted", and the design never
 * lets the record say more than that.
 *
 * The check is the whole point, and it is five conditions rather than one, because each
 * of the four weaker versions was reachable by a sequence of ordinary tool calls:
 *
 * 1. **The note is not already terminal.** Surfaced, withdrawn, and expired stay so.
 * 2. **The offer is still outstanding** — the note's most recent event is `offered`, not
 *    a `declined` that {@link lapseStaleOffers} wrote when the turn moved on. Matching
 *    the last offer's `prompt_id` alone was not enough: lapsing leaves that column
 *    untouched, so a lapsed offer went on answering "yes, that was your turn" forever.
 * 3. **The offer's identity matches, as a pair.** `(session, prompt_id)`, both non-empty,
 *    both equal. A prompt id on its own is a token the model can read out of an ordinary
 *    reply and quote back; the session is what stops one being redeemed from somewhere
 *    else entirely.
 * 4. **The harness observed that turn.** `turn_context` must hold a row for the same pair
 *    with `source = 'hook'`. `begin_turn` will record any turn the model names — correct
 *    for a hookless host, and fatal here — so a volunteered row is not evidence and does
 *    not authorise. This is the condition that makes "the hook authorised it" true of the
 *    *turn*, not merely of the offer.
 * 5. **The daily cap still has room.** Rechecked at the moment of the claim, because the
 *    cap can be lowered, and the window rolls, between the offer and the report.
 *
 * @param noteId the note being surfaced
 * @param turn   the turn claiming it, as the hook observed it; `session` and `promptId`
 *               are both required and are checked against the offer, never trusted
 * @param when   injectable clock
 * @returns the note's view, now `surfaced`
 *
 * @example
 *   offerRipeNotes(store, { turn: 'reply', promptId: 'p-1', session: 's1' });
 *   surfaceNote(store, 1, { turn: 'reply', promptId: 'p-1', session: 's1' }).state
 *   // => 'surfaced'
 *
 * @throws {Error} If the note does not exist, has already reached a terminal state, has
 *                 no outstanding offer, was offered to a different turn or session, was
 *                 offered on a turn no hook observed, or would break the daily cap — the
 *                 message says which, because "it looked delivered" is the failure this
 *                 whole facility exists to prevent.
 *
 * @see offerRipeNotes
 * @see ./context.js hookObservedTurn
 */
export function surfaceNote(
  store  : Store,
  noteId : number,
  turn   : NoteTurn,
  when   : Date = new Date(),
): NoteView {

  const row = store.db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).get(noteId);

  if (row === undefined) {
    throw new Error(`cannot surface note:\n  - #${String(noteId)} does not exist`);
  }

  const budgets = noteBudgets(store),
        nowUtc  = when.toISOString(),
        view    = toView(row, budgets.offerCap, nowUtc);

  if (view.state === 'surfaced' || view.state === 'withdrawn' || view.state === 'expired') {
    throw new Error(
      `cannot surface note:\n  - #${String(noteId)} is '${view.state}', which is terminal`);
  }

  const offerTurn    = row['last_offer_turn'],
        offerPrompt  = row['last_offer_prompt'],
        offerSession = row['last_offer_session'],
        lastEvent    = row['last_event'],
        claimPrompt  = turn.promptId,
        claimSession = turn.session ?? '';

  if (offerTurn !== 'reply' || offerPrompt !== claimPrompt || claimPrompt === '') {
    throw new Error(
      `cannot surface note:\n  - #${String(noteId)} was not offered on this turn ` +
      `(offered on '${String(offerPrompt ?? 'never')}', claimed for ` +
      `'${claimPrompt === '' ? 'no turn at all' : claimPrompt}'). Only a note the ` +
      'UserPromptSubmit hook offered this turn can be surfaced — that gate is what keeps ' +
      'the record from ever claiming a delivery the platform cannot evidence');
  }

  if (offerSession !== claimSession || claimSession === '') {
    throw new Error(
      `cannot surface note:\n  - #${String(noteId)} was offered to session ` +
      `'${String(offerSession ?? 'none')}', not to ` +
      `'${claimSession === '' ? 'no session at all' : claimSession}'. An offer's identity ` +
      'is the pair (session, prompt id); a prompt id on its own is a token, not a proof');
  }

  if (lastEvent !== 'offered') {
    throw new Error(
      `cannot surface note:\n  - #${String(noteId)} has no offer outstanding (its last ` +
      `ledger event is '${String(lastEvent ?? 'none')}'). The offer for '${claimPrompt}' ` +
      'lapsed when that turn ended; a note gets its chance on the turn it was offered and ' +
      'not afterwards, which is what stops a stale offer authorising a claim forever');
  }

  if (!hookObservedTurn(store, claimSession, claimPrompt)) {
    throw new Error(
      `cannot surface note:\n  - no UserPromptSubmit hook ever observed turn ` +
      `'${claimPrompt}' of session '${claimSession}', so nothing authorises surfacing ` +
      `#${String(noteId)} there. begin_turn records a turn you name; the delivery gate ` +
      'wants a turn the harness saw, and those are deliberately different facts');
  }

  if (surfacedRecently(store, when) >= budgets.dailyCap) {
    throw new Error(
      `cannot surface note:\n  - the rolling 24-hour cap of ${String(budgets.dailyCap)} ` +
      'surfaced note(s) is already spent (configure set mailbox.daily_cap <n>). The note ' +
      'keeps its place in the queue; scarcity is the mechanism, not an accident');
  }

  record(store, noteId, 'surfaced',
         { turn: 'reply', promptId: claimPrompt, session: claimSession }, when);

  return { ...view, state: 'surfaced' };

}

/**
 * The mandatory provenance line for one surfaced note.
 *
 * Provenance is a safety property, not decoration. A held note that presented itself as
 * a spontaneous in-the-moment thought would be a small deception about *when* thinking
 * happened — and timing is exactly the dimension this feature grants agency over, so the
 * label is what keeps that agency legible and every timing choice attributable.
 *
 * @param view the note being rendered
 * @returns the two-line block to place at the top of the reply
 *
 * @example
 *   renderHeldNote(note)
 *   // => '📬 Held note #12 — written Saturday evening, held until Tuesday morning; ' +
 *   //    'reason: the deploy window opens then\n   run the reconcile step first'
 */
export function renderHeldNote(view: NoteView): string {
  return `📬 Held note #${String(view.id)} — written ${dayPhrase(new Date(view.writtenUtc))}, ` +
         `held until ${dayPhrase(new Date(view.notBefore))}; reason: ${view.reason}\n` +
         `   ${view.text}`;
}

/**
 * Render notes human-first, one line each, for the CLI's audit door.
 *
 * @returns the printable report; a stated "no notes." rather than emptiness
 *
 * @example
 *   formatNotes([note])
 *   // => '#1 · queued · offers 0/3 · written 9:14 am PDT · ripe 2026-08-30T09:00:00.000Z
 *   //     · deploy window: run the reconcile step first'
 */
export function formatNotes(views: readonly NoteView[]): string {

  if (views.length === 0) { return 'no notes.'; }

  return views.map(view =>
    `#${String(view.id)} · ${view.state} · offers ${String(view.offerCount)} · ` +
    `written ${view.writtenLocal} · ripe ${view.notBefore} · ` +
    `${view.reason}: ${view.text}`).join('\n');

}
