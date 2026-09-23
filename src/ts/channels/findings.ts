/**
 * The format-findings log: what the Stop hook's format checks found, and what they did.
 *
 * The list lint ships in report-only mode, which means its whole output at first is this
 * log. The point of logging before blocking is to learn the false-positive rate while it
 * still costs nobody anything — so every finding is written, in every mode, with the
 * action that was actually taken beside it.
 *
 * Like every other table here, it is INSERT-only.
 *
 * @see ./schema.js FORMAT_FINDINGS_DDL
 * @see ../mcp/hooks.js onStop
 */

import type { Store } from './store.js';

/** Which Stop-hook check produced a finding. */
export const FINDING_CHECKS = ['lists', 'close-line', 'open-line'] as const;

/** One of {@link FINDING_CHECKS}. */
export type FindingCheck = typeof FINDING_CHECKS[number];

/**
 * What the hook did about a finding: `blocked` the stop, only `reported` it to this log,
 * or `warned` the user with a visible message.
 */
export const FINDING_ACTIONS = ['blocked', 'reported', 'warned'] as const;

/** One of {@link FINDING_ACTIONS}. */
export type FindingAction = typeof FINDING_ACTIONS[number];

/** One finding, as written. */
export interface FindingInput {
  readonly session?  : string | undefined;
  readonly promptId? : string | undefined;
  readonly check     : FindingCheck;
  /** What specifically was found, e.g. `ordered-list` or `close-line-missing`. */
  readonly kind      : string;
  readonly severity  : 'violation' | 'warning';
  readonly action    : FindingAction;
  readonly items?    : number | undefined;
  readonly line?     : number | undefined;
  /** A short slice of the assistant's own message; never anything else. */
  readonly excerpt?  : string | undefined;
}

/**
 * Write one finding.
 *
 * @param finding what was found and what was done
 * @param when    injectable clock
 * @returns the new row's id
 *
 * @example
 *   recordFinding(store, { session: 's1', promptId: 'p1', check: 'lists',
 *                          kind: 'ordered-list', severity: 'violation',
 *                          action: 'reported', items: 3, line: 4, excerpt: '1. rebase' })
 *   // => 1
 */
export function recordFinding(store: Store, finding: FindingInput, when: Date = new Date()): number {

  store.db.prepare(`
    INSERT INTO format_findings
      (ts_utc, session, prompt_id, check_name, kind, severity, action, items, line, excerpt)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    when.toISOString(), finding.session ?? null, finding.promptId ?? null,
    finding.check, finding.kind, finding.severity, finding.action,
    finding.items ?? null, finding.line ?? null, finding.excerpt ?? null,
  );

  const row = store.db.prepare('SELECT last_insert_rowid() AS id').get();
  return Number(row?.['id'] ?? 0);

}

/**
 * The most recent findings, newest first.
 *
 * @param limit how many rows to return
 *
 * @example
 *   recentFindings(store, 2)
 *   // => [{ id: 9, check_name: 'lists', kind: 'bullet-list', action: 'reported', … }, …]
 */
export function recentFindings(store: Store, limit = 20): Record<string, unknown>[] {
  return store.db.prepare(
    'SELECT * FROM format_findings ORDER BY id DESC LIMIT ?').all(limit);
}
