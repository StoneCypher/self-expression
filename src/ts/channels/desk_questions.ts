/**
 * Typed, atomic access to the desk's `questions.json` (#98).
 *
 * `questions.json` is owned by the desk server (`src/scripts/desk/panel.mjs`), which
 * rewrites the whole file — `{ questions: [...] }` — on every change: the answer box, the
 * queue buttons, and the drop action all read the array out, mutate one row, and write the
 * whole object back. This module edits it the same way — read, change, write atomically
 * (temp file then rename) — so a half-written file is never observed by either side, and
 * so a row this module writes is one panel.mjs can read right back, and vice versa. It
 * touches only `claimed`; every other field on a row is passed through untouched, because
 * a row this module does not own (`queued`, `answer`, whatever a future card adds) must
 * survive a round trip through `readQuestions` → `writeQuestions` unchanged.
 *
 * The wrapper object, not a bare array, is what actually lives on disk — see
 * `panel.mjs`'s `questions()` (reads `.questions`) and its `/questions` POST handler
 * (writes `{ questions: all }`). Both are treated as read-only reference for the wire
 * shape; this module does not modify `panel.mjs`.
 *
 * @see ../../scripts/desk/panel.mjs
 * @see ../../doc_md/desk.md
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One row of the desk's question queue.
 *
 * Carries the fields this module reads or writes (`id`, `text`, `asked`, the queue and
 * dismissal state, and `claimed`) plus an open index signature for everything else a
 * card puts on a row — `answer`, `answeredAt`, and whatever a future card adds — which
 * this module must preserve across a read/modify/write cycle without knowing its shape.
 */
export interface DeskQuestion {
  readonly id: string;
  readonly text: string;
  readonly asked: string;
  readonly queued?: 'next' | 'agents';
  readonly queuedAt?: string;
  readonly dismissed?: boolean;
  readonly answer?: unknown;
  readonly answeredAt?: string;
  /** Set once, by {@link claimIntent}: who took this open intent, and when. */
  readonly claimed?: { readonly session: string; readonly at: string };
  /** Rows carry fields this module does not own; they are preserved, never inspected. */
  readonly [extra: string]: unknown;
}

/** The on-disk shape of `questions.json`, as `panel.mjs` reads and writes it. */
interface QuestionsFile {
  readonly questions?: readonly DeskQuestion[];
}

/**
 * The path to one desk's `questions.json`.
 *
 * @param deskDir the desk directory (what a desk server is pointed at on the command line)
 * @returns the full path to that desk's question queue
 *
 * @example
 *   questionsPath('/home/me/.desks/mine')  // => '/home/me/.desks/mine/questions.json'
 */
export function questionsPath(deskDir: string): string {
  return join(deskDir, 'questions.json');
}

/**
 * Every question row for one desk, in file order.
 *
 * A missing file reads as no questions yet — a fresh desk has asked nothing — but a
 * *present* file that fails to parse is not swallowed: a truncated or hand-edited
 * `questions.json` is exactly the situation a caller (Task 3's pending source, in
 * particular) needs to hear about rather than silently treat as empty.
 *
 * @param deskDir the desk directory
 * @returns the rows `panel.mjs` would show, or `[]` when the file does not exist
 *
 * @throws {SyntaxError} If the file exists but is not valid JSON.
 *
 * @example
 *   readQuestions('/home/me/.desks/mine')
 *   // => [{ id: 'q1', text: 'merge #21?', asked: '2026-08-30T12:00:00.000Z', queued: 'next' }]
 *
 * @see writeQuestions
 */
export function readQuestions(deskDir: string): DeskQuestion[] {

  const path = questionsPath(deskDir);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return []; }
    throw error;
  }

  const parsed = JSON.parse(raw) as QuestionsFile;
  return [...(parsed.questions ?? [])];

}

/**
 * Replace one desk's whole question queue, atomically.
 *
 * Written to a sibling temp file and renamed into place — never written in place — so a
 * reader (this module or `panel.mjs` itself) can never observe a partial write. This
 * writer is the atomic one, and deliberately not a copy of the desk's own habit:
 * `panel.mjs` rewrites `questions.json` with a bare `writeFileSync`, so a reader that
 * catches one of its writes mid-flight sees truncated JSON. Matching that here would
 * widen the window rather than narrow it.
 *
 * @param deskDir the desk directory
 * @param rows    the complete replacement row set — not a delta; every row not passed
 *                here is gone from the file, exactly as a `panel.mjs` handler replaces
 *                the whole array on every change
 *
 * @example
 *   writeQuestions('/home/me/.desks/mine', [
 *     { id: 'q1', text: 'merge #21?', asked: '2026-08-30T12:00:00.000Z', queued: 'next' },
 *   ]);
 *
 * @see readQuestions
 */
export function writeQuestions(deskDir: string, rows: readonly DeskQuestion[]): void {
  const path = questionsPath(deskDir),
        tmp  = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, JSON.stringify({ questions: rows }, null, 2) + '\n');
  renameSync(tmp, path);
}

/**
 * The rows a desk owner has not yet acted on and nobody has claimed: queued for `next` or
 * `agents`, not dismissed, not already claimed.
 *
 * The set {@link claimIntent} may hand out, and the set Task 3's pending source turns into
 * notice items — an "open intent" is exactly a row someone asked the desk to route
 * somewhere, that is still waiting for that to happen.
 *
 * @param rows the full row set, as {@link readQuestions} returns it
 * @returns the open rows, in their original order
 *
 * @example
 *   openIntents([
 *     { id: 't1', text: 'a', asked: T, queued: 'next' },
 *     { id: 't2', text: 'b', asked: T, queued: 'agents', claimed: { session: 's', at: T } },
 *     { id: 't3', text: 'c', asked: T, queued: 'next', dismissed: true },
 *     { id: 't4', text: 'd', asked: T },
 *   ])
 *   // => [{ id: 't1', text: 'a', asked: T, queued: 'next' }]
 */
export function openIntents(rows: readonly DeskQuestion[]): DeskQuestion[] {
  return rows.filter(row =>
    (row.queued === 'next' || row.queued === 'agents') &&
    row.dismissed !== true &&
    row.claimed === undefined
  );
}

/**
 * Claim one open intent for a session, atomically: the row is stamped `claimed` and
 * written back; every other field on it is passed through untouched.
 *
 * "Atomic" here means the whole read → find → stamp → write happens as one call with no
 * await in between, so two callers in the same process cannot both observe the row as
 * open and both claim it — the second one always sees the first's `claimed` field once it
 * re-reads. It does not defend against two separate *processes* racing the same file;
 * nothing in this desk mechanism does, and none has needed to yet.
 *
 * @param deskDir the desk directory
 * @param id      the row's `id`
 * @param session the claiming session's identity, stored verbatim
 * @param now     the claim's timestamp
 * @returns the stamped row, or `null` when `id` names no open intent — either it does not
 *          exist, or it is not queued, is dismissed, or is already claimed
 *
 * @example
 *   claimIntent('/home/me/.desks/mine', 't1', 'sess-1', new Date('2026-08-30T12:05:00.000Z'))
 *   // => { id: 't1', text: 'a', asked: T, queued: 'agents',
 *   //      claimed: { session: 'sess-1', at: '2026-08-30T12:05:00.000Z' } }
 *
 * @see openIntents
 * @see writeQuestions
 */
export function claimIntent(
  deskDir : string,
  id      : string,
  session : string,
  now     : Date,
): DeskQuestion | null {

  const rows   = readQuestions(deskDir),
        target = openIntents(rows).find(row => row.id === id);

  if (target === undefined) { return null; }

  const stamped: DeskQuestion = { ...target, claimed: { session, at: now.toISOString() } };

  writeQuestions(deskDir, rows.map(row => row.id === id ? stamped : row));

  return stamped;

}
