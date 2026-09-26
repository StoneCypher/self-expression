/**
 * Types for `deskinbox.mjs`, so the tests and any TypeScript caller see its contract.
 *
 * Hand-written rather than emitted, for the same reason as `deskcards.d.mts` and
 * `deskguard.d.mts` beside it: the module is plain ESM with no build step, so this file is
 * the one place kept in step with it by hand. Drift shows up as a failing test.
 *
 * @see ./deskinbox.mjs
 */

/** Exactly a GitHub issue or pull-request permalink. */
export declare const ISSUE_URL: RegExp;

/** A GitHub `owner/name` pair that cannot be read as an option or a path. */
export declare const REPO_NAME: RegExp;

/** What the owner can ask for a pull request. */
export type PrAction = 'land' | 'agent' | 'drop';

/** Every {@link PrAction}, in the order the inbox offers them. */
export declare const PR_ACTIONS: readonly PrAction[];

/** How long one `gh pr list` answer is reused, in milliseconds. */
export declare const PR_TTL_MS: number;

/** The label that marks a pull request an agent opened. */
export declare const AI_LABEL: string;

/** The parts of `desk-config.json` the inbox reads; everything else passes through untouched. */
export interface DeskConfig {
  name?: string;
  repo?: unknown;
  prHidden?: unknown[];
  prIntent?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One pull request as the inbox shows it. */
export interface InboxPr {
  number: number;
  title: string;
  draft: boolean;
  review: string | null;
  ai: boolean;
  intent: PrAction | null;
}

/** The two lists, split by whose account opened each PR. */
export interface PrSplit {
  mine: InboxPr[];
  theirs: InboxPr[];
}

/** What `/prs` serves: the lists, plus anything the inbox must say instead of going blank. */
export interface PrFeedResult extends PrSplit {
  repo: string | null;
  viewer: string | null;
  error: string | null;
  warning: string | null;
  fetchedAt: string | null;
}

/** A command runner's answer. It never rejects. */
export type RunResult = { ok: true; stdout: string } | { ok: false; error: string };

/** Runs `gh` with the given argv. */
export type Runner = (args: string[]) => Promise<RunResult>;

/** Records one audited action. */
export type AuditFn = (action: string, detail: Record<string, unknown>) => void;

/** The inbox document held in `questions.json`. */
export interface InboxDoc {
  questions: Record<string, unknown>[];
  reserve: Record<string, unknown>[];
}

/** What one inbox post did, for the log; `null` when it changed nothing. */
export type InboxEvent = Record<string, unknown> & { action: string };

export declare function isIssueUrl(url: unknown): boolean;

export declare function resolveRepo(envValue: string | undefined, cfg: DeskConfig | null | undefined):
  { repo: string; problem: null } | { repo: null; problem: string };

export declare function hiddenPrs(cfg: DeskConfig | null | undefined): Set<number>;

export declare function splitPullRequests(rows: unknown, opts: { viewer: string | null; cfg: DeskConfig | null | undefined }): PrSplit;

export declare function applyPrIntent(cfg: DeskConfig, number: unknown, action: unknown): DeskConfig | null;

export declare function auditRow(action: string, detail: Record<string, unknown>, at: string): Record<string, unknown>;

export declare function readAudit(text: string, want?: number): { rows: Record<string, unknown>[]; showing: number };

export declare function openerFor(platform: string, url: string): [string, string[]];

export declare function launchDetached(cmd: string, args: string[]): void;

export declare function openExternally(url: unknown, deps?: {
  launch?: (cmd: string, args: string[]) => void;
  audit?: AuditFn;
  platform?: string;
}): boolean;

export declare function ghFailure(err: unknown, stderr: unknown, bin: string): string;

export declare function ghRunner(bin?: string): Runner;

export declare function createPullRequestFeed(deps: {
  run: Runner;
  readConfig: () => DeskConfig;
  env: string | undefined;
  now?: () => number;
  ttlMs?: number;
}): { get: () => Promise<PrFeedResult>; invalidate: () => void };

export declare function parseInbox(text: string): InboxDoc;

export declare function applyInboxPost(doc: InboxDoc, post: unknown, at: string): { doc: InboxDoc; event: InboxEvent | null };
