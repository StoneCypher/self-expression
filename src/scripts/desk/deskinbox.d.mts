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
  ticketLabels?: unknown[];
  ticketLimit?: unknown;
  ticketHidden?: unknown[];
  ticketIntent?: Record<string, unknown>;
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

/** Resolves to the owner's GitHub login, or `null` when GitHub could not say. */
export type Whoami = () => Promise<string | null>;

export declare function createViewerLookup(run: Runner): Whoami;

export declare function createPullRequestFeed(deps: {
  run: Runner;
  readConfig: () => DeskConfig;
  env: string | undefined;
  now?: () => number;
  ttlMs?: number;
  whoami?: Whoami;
}): { get: () => Promise<PrFeedResult>; invalidate: () => void };

/** The labels that qualify an issue for the ticket rail when the config names none. */
export declare const DEFAULT_TICKET_LABELS: readonly string[];

/** How many tracker tickets the rail shows when the config does not say. */
export declare const DEFAULT_TICKET_LIMIT: number;

/** What the owner can ask for a ticket. */
export type TicketAction = 'next' | 'agents' | 'drop';

/** Every {@link TicketAction}, in the order the rail offers them. */
export declare const TICKET_ACTIONS: readonly TicketAction[];

/** How long one `gh issue list` answer is reused, in milliseconds. */
export declare const ISSUE_TTL_MS: number;

/** One tracker issue as the ticket rail shows it. */
export interface InboxTicket {
  number: number;
  title: string;
  url: string;
  /** The qualifying labels this issue carries, as GitHub spells them. */
  labels: string[];
  assigned: boolean;
  intent: Exclude<TicketAction, 'drop'> | null;
}

/** The rail's tracker rows, and how many more qualifying issues wait behind them. */
export interface TicketSelection {
  tickets: InboxTicket[];
  bench: number;
}

/** What `/tickets` serves: the rows, plus anything the inbox must say instead of going blank. */
export interface TicketFeedResult extends TicketSelection {
  repo: string | null;
  viewer: string | null;
  labels: string[];
  error: string | null;
  warning: string | null;
  fetchedAt: string | null;
}

export declare function ticketLabels(cfg: DeskConfig | null | undefined): string[];

export declare function ticketLimit(cfg: DeskConfig | null | undefined): number;

export declare function hiddenTickets(cfg: DeskConfig | null | undefined): Set<string>;

export declare function ticketPermalink(row: Record<string, unknown> | null | undefined, repo: string | null): string | null;

export declare function selectTickets(rows: unknown, opts: {
  viewer: string | null;
  cfg: DeskConfig | null | undefined;
  repo: string | null;
  handWritten?: Set<string>;
}): TicketSelection;

export declare function applyTicketIntent(cfg: DeskConfig, url: unknown, action: unknown): DeskConfig | null;

export declare function createIssueFeed(deps: {
  run: Runner;
  readConfig: () => DeskConfig;
  readInbox: () => { questions: Record<string, unknown>[] };
  env: string | undefined;
  now?: () => number;
  ttlMs?: number;
  whoami?: Whoami;
}): { get: () => Promise<TicketFeedResult>; invalidate: () => void };

export declare function parseInbox(text: string): InboxDoc;

export declare function applyInboxPost(doc: InboxDoc, post: unknown, at: string): { doc: InboxDoc; event: InboxEvent | null };
