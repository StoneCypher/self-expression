/**
 * The single enforcement point for public aggregation: which fields may leave the
 * machine, in exactly what form (issue #31).
 *
 * The governing decision is non-negotiable: **free text is never part of a public
 * aggregation.** This module turns that decision into a column-by-column contract.
 * Three rules hold everywhere:
 *
 * - **Allowlist, never denylist.** Every column is private unless it appears in
 *   {@link PUBLIC_TREATMENTS}, and {@link exportPublicRows} constructs its `SELECT`
 *   list exclusively from that table — there is no `SELECT *` anywhere on the export
 *   path, so an unlisted column is unreachable by construction rather than filtered.
 * - **Closed domains only.** A field is exportable only if its value domain is closed,
 *   numeric, or validated down to one; open strings either validate against a closed
 *   list at export time (failing to `NULL`) or do not export at all.
 * - **Classification is total.** Every `entries` column appears in the table with an
 *   explicit treatment, including `excluded`, and a test enforces totality against
 *   `ENTRIES_DDL` — adding a schema column without classifying it fails the build.
 *
 * The preview *is* the export: {@link previewPublicExport} renders the actual return
 * value of {@link exportPublicRows}, so "here is exactly what would be sent" is
 * literal and cannot drift.
 *
 * Honest claim, stated once so the docs never overstate it: *no free text, reduced
 * linkage, coarsened time.* This is not differential privacy and not k-anonymity.
 *
 * @see ./schema.js
 * @see ../mcp/share_tools.js
 * @see ../../superpowers/spec/2026-08-27-structured-aggregation-design.md
 */

import { createHmac, randomUUID, randomBytes } from 'node:crypto';

import { SCHEMA_VERSION } from './schema.js';
import { readConfig }     from './store.js';
import { effectiveValue } from './config.js';
import type { Store }     from './store.js';

/** How far `ts_utc` (and the export timestamp) are truncated. */
export type TimeGranularity = 'hour' | 'day';

/**
 * The conventional-commit types `cctype` validates against at export time.
 *
 * The stored column is an open string (host conventions vary); only a value exactly on
 * this closed list survives export, anything else becomes `NULL` — an open string must
 * never ride out inside a "structured" field.
 */
export const CC_TYPES = [
  'feat', 'fix', 'hotfix', 'docs', 'refactor', 'perf', 'test',
  'chore', 'ci', 'build', 'style', 'release', 'revert',
] as const;

/**
 * One column's export disposition.
 *
 * - `verbatim`  — closed vocabularies and safe scalars, exported as stored (with an
 *                 abuse-valve length cap on the two deliberately-open product names).
 * - `coarsen`   — signal kept, resolution destroyed (hour/day truncation, log2
 *                 buckets, a 33+ ceiling, major-version truncation).
 * - `hash`      — HMAC-SHA-256 under a per-submission salt: grouping survives inside
 *                 one submission, linkage across submissions dies with the salt.
 * - `derive`    — a safe field computed from an unsafe one; the raw value never leaves.
 * - `excluded`  — never exported, no derived form.
 */
export type Treatment =
  | { readonly kind: 'verbatim'; readonly note: string; readonly maxLength?: number }
  | { readonly kind: 'coarsen';  readonly note: string;
      readonly method: 'timestamp' | 'pow2' | 'cap32' | 'major_version' }
  | { readonly kind: 'hash';     readonly note: string; readonly of?: 'target_uuid' }
  | { readonly kind: 'derive';   readonly note: string; readonly outputs: readonly string[] }
  | { readonly kind: 'excluded'; readonly note: string };

/**
 * The complete treatment table: every `entries` column, exactly once, mapped to how —
 * or whether — it leaves the machine.
 *
 * This object is simultaneously the executable allowlist ({@link exportPublicRows}
 * builds its `SELECT` from it), the preview's disposition table, and the object the
 * totality test checks against `ENTRIES_DDL` — one artifact, three readers, so they
 * cannot disagree.
 */
export const PUBLIC_TREATMENTS: Readonly<Record<string, Treatment>> = {

  // ── excluded: identity, prose, and prose-in-costume ────────────────────────────
  id              : { kind: 'excluded', note: 'local rowid; meaningless and linkable off-machine' },
  text            : { kind: 'excluded', note: 'free text — the field this whole boundary exists for' },
  title           : { kind: 'excluded', note: 'free text display title; routinely names clients and products' },
  cwd             : { kind: 'excluded', note: 'filesystem path; employer, client, and project names' },
  project         : { kind: 'excluded', note: 'project name; same leak as cwd in name form' },
  git_branch      : { kind: 'excluded', note: 'branch names embed tickets, clients, and product names' },
  tz              : { kind: 'excluded', note: 'coarse location; local_period/local_dow carry the circadian signal instead' },
  agent_type      : { kind: 'excluded', note: 'user-named open vocabulary; subagent names embed project and client names' },
  context_emoji   : { kind: 'excluded', note: 'multi-emoji with a weaker convention than face; revisit only with an equally strict validator' },
  permission_mode : { kind: 'excluded', note: 'host-defined open string; promotable to verbatim if it ever gains a closed vocabulary' },
  turn_index      : { kind: 'excluded', note: 'fine-grained session-structure fingerprint; hashed prompt_id already groups turns' },

  // ── verbatim: closed vocabularies and safe scalars ─────────────────────────────
  channel         : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  position        : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  delta           : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  turn            : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  effort          : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  modality        : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  confidence      : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  divergence_kind : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary' },
  stem            : { kind: 'verbatim', note: 'CHECK-constrained closed vocabulary; the public affect signal' },
  uncertain       : { kind: 'verbatim', note: 'boolean' },
  visible         : { kind: 'verbatim', note: 'boolean' },
  nudged          : { kind: 'verbatim', note: 'boolean' },
  interrupted     : { kind: 'verbatim', note: 'boolean' },
  succ            : { kind: 'verbatim', note: 'checklist count; small bounded integer' },
  active          : { kind: 'verbatim', note: 'checklist count; small bounded integer' },
  fail            : { kind: 'verbatim', note: 'checklist count; small bounded integer' },
  percent         : { kind: 'verbatim', note: 'bounded integer 0-100' },
  model           : { kind: 'verbatim', note: 'the study variable; open by design, names a product not a person', maxLength: 64 },
  platform        : { kind: 'verbatim', note: 'already coarse: win32 / darwin / linux' },
  host            : { kind: 'verbatim', note: 'host application name; product, not person', maxLength: 64 },
  plugin_version  : { kind: 'verbatim', note: 'version of this software; required to interpret rows' },
  format_version  : { kind: 'verbatim', note: 'recording-convention label of this software' },

  // ── coarsen: signal kept, resolution destroyed ─────────────────────────────────
  ts_utc          : { kind: 'coarsen', method: 'timestamp',     note: 'truncated to the hour by default, configurable to day' },
  prompt_len      : { kind: 'coarsen', method: 'pow2',          note: 'log2 bucket; exact lengths are join keys, buckets are not' },
  response_len    : { kind: 'coarsen', method: 'pow2',          note: 'log2 bucket' },
  context_tokens  : { kind: 'coarsen', method: 'pow2',          note: 'log2 bucket' },
  output_tokens   : { kind: 'coarsen', method: 'pow2',          note: 'log2 bucket' },
  thinking_tokens : { kind: 'coarsen', method: 'pow2',          note: 'log2 bucket' },
  elapsed_ms      : { kind: 'coarsen', method: 'pow2',          note: 'log2 bucket' },
  tool_calls      : { kind: 'coarsen', method: 'cap32',         note: 'verbatim up to 32, then a single 33+ ceiling bucket' },
  error_count     : { kind: 'coarsen', method: 'cap32',         note: 'verbatim up to 32, then 33+' },
  compactions     : { kind: 'coarsen', method: 'cap32',         note: 'verbatim up to 32, then 33+' },
  host_version    : { kind: 'coarsen', method: 'major_version', note: 'truncated to the major version' },

  // ── hash: per-submission salt — grouping survives, linkage dies ────────────────
  uuid            : { kind: 'hash', note: 'row identity within the submission; never exported raw — raw uuids would re-link resubmitted rows' },
  session         : { kind: 'hash', note: 'groups a session\'s rows' },
  prompt_id       : { kind: 'hash', note: 'groups one turn\'s rows' },
  machine_id      : { kind: 'hash', note: 'distinguishes machines within a submission only' },
  agent_id        : { kind: 'hash', note: 'groups a subagent\'s rows; also derives the is_subagent boolean' },
  corrects_id     : { kind: 'hash', of: 'target_uuid', note: 'exported as corrects_uuid: the salted hash of the target row\'s uuid, keeping the correction edge inside the submission' },
  series_key      : { kind: 'hash', note: 'the key is a user-chosen name; the hash keeps series grouping without the name' },

  // ── derive: a safe field computed from unsafe ones ─────────────────────────────
  ts_local        : { kind: 'derive', outputs: ['local_period', 'local_dow'], note: 'six-hour band and weekday/weekend; the raw local time and its zone never leave' },
  cctype          : { kind: 'derive', outputs: ['cctype'],                    note: 'validated against the closed conventional-commit type list; anything else exports NULL' },
  face            : { kind: 'derive', outputs: ['face'],                      note: 'validated as exactly one emoji grapheme; anything else exports NULL' },

};

/**
 * Truncate an ISO 8601 UTC timestamp to the requested granularity, or `null` when the
 * value is not a recognizable ISO UTC timestamp.
 *
 * Pure string surgery on a validated shape rather than a Date round-trip, so the
 * result is stable regardless of the exporting machine's clock or zone.
 *
 * @param iso the stored `ts_utc`, e.g. `2026-08-18T16:14:09.123Z`
 * @returns `2026-08-18T16:00:00Z` at `hour`, `2026-08-18` at `day`, or `null`
 *
 * @example
 *   coarsenTimestamp('2026-08-18T16:14:09.123Z', 'hour')  // => '2026-08-18T16:00:00Z'
 *   coarsenTimestamp('2026-08-18T16:14:09.123Z', 'day')   // => '2026-08-18'
 *   coarsenTimestamp('yesterday-ish', 'hour')             // => null
 */
export function coarsenTimestamp(iso: string, granularity: TimeGranularity): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) { return null; }
  return granularity === 'day' ? iso.slice(0, 10) : `${iso.slice(0, 13)}:00:00Z`;
}

/**
 * The log2 bucket index of a non-negative count: 0 -> 0, 1-2 -> 1, 3-4 -> 2,
 * 5-8 -> 3, 9-16 -> 4, and so on.
 *
 * Exact token and length counts are join keys against any other dataset holding the
 * same session; bucket indices are not. Negative values clamp to bucket 0 rather than
 * erroring, because a defensive exporter must not fail open on odd data.
 *
 * @example
 *   pow2Bucket(0)     // => 0
 *   pow2Bucket(2)     // => 1
 *   pow2Bucket(5)     // => 3
 *   pow2Bucket(1000)  // => 10
 */
export function pow2Bucket(value: number): number {
  if (value <= 0) { return 0; }
  let bucket = 1, ceiling = 2;
  while (ceiling < value) { ceiling *= 2; bucket += 1; }
  return bucket;
}

/**
 * A small counter exported verbatim up to 32, then collapsed into a single `'33+'`
 * ceiling bucket, with negatives clamped to 0.
 *
 * The tail is where the identifying variance lives — "the session with 61 errors" is
 * a fingerprint; "a session with 33+ errors" is a population.
 *
 * @example
 *   capCount(7)    // => 7
 *   capCount(32)   // => 32
 *   capCount(33)   // => '33+'
 */
export function capCount(value: number): number | '33+' {
  if (value <= 0)  { return 0; }
  if (value <= 32) { return Math.floor(value); }
  return '33+';
}

/**
 * The leading major-version digits of a version string, or `null` when none lead it.
 *
 * A full host version is a fine-grained cohort marker (and occasionally embeds build
 * metadata); the major version keeps the compatibility signal only.
 *
 * @example
 *   majorVersion('2.0.14')      // => '2'
 *   majorVersion('v2.0.14')     // => null — not digits-first; fails safe to null
 */
export function majorVersion(version: string): string | null {
  const matched = /^(\d+)/.exec(version.trim());
  return matched?.[1] ?? null;
}

/**
 * HMAC-SHA-256 of `value` under a per-submission salt, truncated to 128 bits of hex.
 *
 * Within one submission equal inputs hash equal, so grouping works; across
 * submissions the salt differs and nothing joins. The salt must be generated fresh at
 * export time and never persisted.
 *
 * @param salt  at least 16 bytes of fresh randomness; 32 is the intended size
 * @param value the identifier to blind
 * @returns 32 lowercase hex characters
 *
 * @example
 *   const salt = freshSalt();
 *   saltedHash(salt, 'session-a') === saltedHash(salt, 'session-a')  // => true
 *
 * @throws {Error} If the salt is shorter than 16 bytes — a degenerate salt would turn
 *                 the hash into a dictionary-attackable label.
 */
export function saltedHash(salt: Uint8Array, value: string): string {
  if (salt.length < 16) { throw new Error('salt must be at least 16 bytes; generate it with freshSalt()'); }
  return createHmac('sha256', salt).update(value).digest('hex').slice(0, 32);
}

/**
 * A fresh 32-byte per-submission salt.
 *
 * Exists as a named function so every call site says what the bytes are for, and so
 * tests can confirm two exports never share one.
 *
 * @example
 *   freshSalt().length  // => 32
 */
export function freshSalt(): Uint8Array {
  return randomBytes(32);
}

/**
 * Parse the stored local-clock rendering (`9:14 am PDT`) into a 24-hour hour, or
 * `null` when it does not match the recording convention.
 *
 * @example
 *   localClockHour('9:14 am PDT')   // => 9
 *   localClockHour('12:03 am UTC')  // => 0
 *   localClockHour('garbage')       // => null
 */
export function localClockHour(tsLocal: string): number | null {
  const matched = /^(\d{1,2}):(\d{2}) (am|pm)\b/.exec(tsLocal.trim());
  if (matched === null) { return null; }
  const raw = Number(matched[1] ?? '');
  if (raw < 1 || raw > 12) { return null; }
  const base = raw % 12;
  return matched[3] === 'pm' ? base + 12 : base;
}

/**
 * The six-hour local band a row was recorded in, derived from the rendered local
 * clock; `null` when the local time cannot be parsed.
 *
 * This is the deliberate replacement for exporting `tz` or a UTC offset: circadian
 * structure is affect-relevant, location is not.
 *
 * @example
 *   localPeriod('3:00 am PDT')   // => 'night'
 *   localPeriod('9:14 am PDT')   // => 'morning'
 *   localPeriod('2:30 pm PDT')   // => 'afternoon'
 *   localPeriod('11:59 pm PDT')  // => 'evening'
 */
export function localPeriod(tsLocal: string): 'night' | 'morning' | 'afternoon' | 'evening' | null {
  const hour = localClockHour(tsLocal);
  if (hour === null)  { return null; }
  if (hour < 6)  { return 'night'; }
  if (hour < 12) { return 'morning'; }
  if (hour < 18) { return 'afternoon'; }
  return 'evening';
}

/**
 * Whether the row's *local* calendar day was a weekday or a weekend, derived from
 * `ts_utc` plus the clock difference to the rendered local time; `null` when either
 * timestamp fails to parse.
 *
 * The stored local rendering carries a clock but no date, so the local date is
 * reconstructed: the minute-of-day difference between the local clock and the UTC
 * clock brackets the UTC offset, resolved to the candidate with the smaller absolute
 * offset (ties break positive). Stated residual: zones beyond UTC+12 resolve to the
 * wrong side of the date line and may misclassify — a bounded, weekend-only error
 * accepted over exporting any zone information at all.
 *
 * @example
 *   localDow('2026-08-22T10:00:00.000Z', '3:00 am PDT')  // => 'weekend' (a Saturday in PDT)
 *   localDow('2026-08-24T10:00:00.000Z', '3:00 am PDT')  // => 'weekday'
 */
export function localDow(tsUtc: string, tsLocal: string): 'weekday' | 'weekend' | null {

  const parsed = Date.parse(tsUtc),
        hour   = localClockHour(tsLocal),
        minute = /^(\d{1,2}):(\d{2}) /.exec(tsLocal.trim());

  if (Number.isNaN(parsed) || hour === null || minute === null) { return null; }

  const utc          = new Date(parsed),
        utcMinutes   = utc.getUTCHours() * 60 + utc.getUTCMinutes(),
        localMinutes = hour * 60 + Number(minute[2] ?? '0'),
        residue      = ((localMinutes - utcMinutes) % 1440 + 1440) % 1440,
        offset       = residue <= 720 ? residue : residue - 1440,
        localDay     = new Date(parsed + offset * 60_000).getUTCDay();

  return localDay === 0 || localDay === 6 ? 'weekend' : 'weekday';

}

/**
 * `value` when it is a member of the closed vocabulary, else `null`.
 *
 * The export-time validator for stored open strings whose *intended* domain is
 * closed: a value off the list is not sanitized or truncated, it simply does not
 * export.
 *
 * @example
 *   closedOrNull(CC_TYPES, 'feat')        // => 'feat'
 *   closedOrNull(CC_TYPES, 'feat: oops')  // => null
 */
export function closedOrNull<T extends string>(vocabulary: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value)
    ? value as T
    : null;
}

const RGI_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');

/**
 * `value` when it is exactly one emoji grapheme, else `null`.
 *
 * A single validated emoji cannot carry prose, so `face` keeps its affect signal; two
 * graphemes, ASCII, or mixed strings all fail to `null`. Uses grapheme segmentation
 * plus the RGI emoji property, so ZWJ sequences and skin tones count as one.
 *
 * @example
 *   singleEmoji('🙂')    // => '🙂'
 *   singleEmoji('🙂🙂')  // => null
 *   singleEmoji('ok')    // => null
 */
export function singleEmoji(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') { return null; }
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  if (graphemes.length !== 1) { return null; }
  return RGI_EMOJI.test(value) ? value : null;
}

/** Options an export runs under; surfaced verbatim in the export's `meta`. */
export interface ExportOptions {
  /** Truncation applied to `ts_utc` and the export timestamp. */
  readonly granularity   : TimeGranularity;
  /** Stamped into `meta` so a submission names the software that shaped it. */
  readonly pluginVersion : string;
  /** Injectable clock for the export timestamp; defaults to now. */
  readonly now?          : Date;
}

/** The submission-level facts accompanying the rows. */
export interface ExportMeta {
  /** Random per-export identifier; fresh every time, linking nothing. */
  readonly submission_id    : string;
  readonly schema_version   : number;
  readonly plugin_version   : string;
  readonly time_granularity : TimeGranularity;
  /** When the export ran, coarsened to the same granularity as the rows. */
  readonly exported         : string | null;
  /** Whether sharing was affirmatively enabled with an opt-in moment on record. */
  readonly share_enabled    : boolean;
  readonly row_count        : number;
}

/** One export: the meta block plus the shaped rows, serializable as one JSON document. */
export interface PublicExport {
  readonly meta : ExportMeta;
  readonly rows : readonly Record<string, unknown>[];
}

/** The opt-in facts the gate reads. */
export interface ShareWindow {
  /** True only when `share.enabled` is stored as exactly `'true'`. */
  readonly enabled    : boolean;
  /** The most recent opt-in moment, or `null` when none is validly on record. */
  readonly optedInUtc : string | null;
}

/**
 * Read the opt-in gate: sharing posture inverted from `privacy.*`.
 *
 * Only the exact stored string `'true'` enables — absence means no, any other value
 * means no — the mirror image of privacy's "only exact `'false'` suppresses". The
 * opt-in moment is read tolerantly (an invalid stored timestamp behaves as absent),
 * and eligibility requires *both* facts: enabled with no recorded moment exports
 * nothing, failing safe.
 *
 * @example
 *   shareWindow(store)  // => { enabled: false, optedInUtc: null } on a fresh install
 */
export function shareWindow(store: Store): ShareWindow {
  return {
    enabled    : readConfig(store, 'share.enabled') === 'true',
    optedInUtc : effectiveValue(store, 'share.opted_in_utc'),
  };
}

/** Coerce a sqlite value to a finite number, else `null`. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'bigint') { return Number(value); }
  return null;
}

/** Coerce a sqlite value to text, else `null` — never Object default stringification. */
function asText(value: unknown): string | null {
  if (typeof value === 'string') { return value; }
  if (typeof value === 'number' || typeof value === 'bigint') { return String(value); }
  return null;
}

/** The SELECT column list, derived from the treatment table — never written by hand. */
function selectList(): string {
  const columns: string[] = [];
  for (const [column, treatment] of Object.entries(PUBLIC_TREATMENTS)) {
    if (treatment.kind === 'excluded') { continue; }
    if (treatment.kind === 'hash' && treatment.of === 'target_uuid') {
      columns.push(`(SELECT e2.uuid FROM entries e2 WHERE e2.id = entries.${column}) AS ${column}`);
      continue;
    }
    columns.push(column);
  }
  return columns.join(', ');
}

/** Apply one row's treatments, driven by the table rather than by hand-picked fields. */
function shapeRow(
  raw         : Record<string, unknown>,
  salt        : Uint8Array,
  granularity : TimeGranularity,
): Record<string, unknown> {

  const out: Record<string, unknown> = {};

  for (const [column, treatment] of Object.entries(PUBLIC_TREATMENTS)) {

    const value = raw[column];

    switch (treatment.kind) {

      case 'excluded':
        break;

      case 'verbatim':
        out[column] = treatment.maxLength !== undefined && typeof value === 'string'
          ? value.slice(0, treatment.maxLength)
          : value ?? null;
        break;

      case 'coarsen': {
        const text = asText(value);
        if (text === null)                        { out[column] = null; break; }
        if (treatment.method === 'timestamp')     { out[column] = coarsenTimestamp(text, granularity); break; }
        if (treatment.method === 'major_version') { out[column] = majorVersion(text); break; }
        const numeric = asNumber(value);
        out[column] = numeric === null ? null
                    : treatment.method === 'pow2' ? pow2Bucket(numeric)
                    : capCount(numeric);
        break;
      }

      case 'hash': {
        const name = treatment.of === 'target_uuid' ? 'corrects_uuid' : column,
              text = asText(value);
        out[name] = text === null ? null : saltedHash(salt, text);
        if (column === 'agent_id') { out['is_subagent'] = text !== null; }
        break;
      }

      case 'derive':
        if (column === 'ts_local') {
          const local = typeof value === 'string' ? value : '';
          out['local_period'] = localPeriod(local);
          out['local_dow']    = localDow(asText(raw['ts_utc']) ?? '', local);
        } else if (column === 'cctype') {
          out['cctype'] = closedOrNull(CC_TYPES, value);
        } else {
          out['face'] = singleEmoji(value);
        }
        break;

    }

  }

  return out;

}

/**
 * Shape every eligible row for public aggregation — the only code that does.
 *
 * The `SELECT` list is built from {@link PUBLIC_TREATMENTS}; an unlisted column is
 * never read. Eligibility is the opt-in event: only rows with `ts_utc` at or after
 * the most recent opt-in moment qualify, so rows recorded before it are permanently
 * outside the export — never retroactive. When sharing is off, or no opt-in moment is
 * on record, the result carries zero rows and says so in `meta`.
 *
 * @param store   the local database
 * @param salt    the per-submission salt, fresh from {@link freshSalt}, never persisted
 * @param options granularity and provenance stamped into the document
 * @returns the complete submission document; serialize with `JSON.stringify`
 *
 * @example
 *   const doc = exportPublicRows(store, freshSalt(), { granularity: 'hour', pluginVersion: '0.2.1' });
 *   doc.rows[0]?.['text']  // => undefined — the column is unreachable, not blanked
 *
 * @throws {Error} If the salt is shorter than 16 bytes (see {@link saltedHash}).
 *
 * @see previewPublicExport
 */
export function exportPublicRows(store: Store, salt: Uint8Array, options: ExportOptions): PublicExport {

  if (salt.length < 16) { throw new Error('salt must be at least 16 bytes; generate it with freshSalt()'); }

  const window   = shareWindow(store),
        eligible = window.enabled && window.optedInUtc !== null,
        now      = options.now ?? new Date();

  const raws = eligible
    ? store.db.prepare(
        `SELECT ${selectList()} FROM entries WHERE ts_utc >= ? ORDER BY id`
      ).all(window.optedInUtc)
    : [];

  const rows = raws.map(raw => shapeRow(raw, salt, options.granularity));

  return {
    meta: {
      submission_id    : randomUUID(),
      schema_version   : SCHEMA_VERSION,
      plugin_version   : options.pluginVersion,
      time_granularity : options.granularity,
      exported         : coarsenTimestamp(now.toISOString(), options.granularity),
      share_enabled    : eligible,
      row_count        : rows.length,
    },
    rows,
  };

}

/** A preview: the rendered text plus the very document it rendered. */
export interface PublicPreview {
  readonly rendered : string;
  readonly document : PublicExport;
}

/** How many sample rows the preview prints in full. */
const PREVIEW_SAMPLE_ROWS = 3;

/**
 * Render "here is exactly what would be sent" — by calling {@link exportPublicRows}
 * and rendering its actual return value.
 *
 * The preview cannot drift from the export because it *is* the export, minus only the
 * final write: the returned `document` is byte-for-byte what an export under the same
 * salt and options would produce. Renders the full treatment table (every column's
 * disposition) plus a column-per-line sample of the first rows.
 *
 * @param store   the local database
 * @param options granularity and provenance, exactly as the export would receive them
 * @param salt    injectable for tests; defaults to a fresh throwaway salt
 *
 * @example
 *   previewPublicExport(store, { granularity: 'hour', pluginVersion: '0.2.1' }).rendered
 *   // => 'public export preview …\n  channel : verbatim — …'
 *
 * @see exportPublicRows
 */
export function previewPublicExport(
  store   : Store,
  options : ExportOptions,
  salt    : Uint8Array = freshSalt(),
): PublicPreview {

  const document = exportPublicRows(store, salt, options),
        window   = shareWindow(store),
        lines    : string[] = [];

  lines.push('public export preview — rendered from the exporter\'s actual output; what you see is all that goes');
  lines.push('');
  lines.push(`sharing     : ${document.meta.share_enabled ? 'on' : 'off'}${
    document.meta.share_enabled ? ''
    : window.enabled ? ' (share.enabled is true but no opt-in moment is on record)'
    : ' (share.enabled is not exactly true; nothing exports)'}`);
  lines.push(`granularity : ${document.meta.time_granularity}`);
  lines.push(`eligible    : ${String(document.meta.row_count)} rows${
    window.optedInUtc === null ? '' : ` recorded at or after the opt-in moment ${window.optedInUtc}`}`);
  lines.push('');
  lines.push('column treatments (allowlist — an unlisted column cannot be selected at all):');

  const width = Math.max(...Object.keys(PUBLIC_TREATMENTS).map(k => k.length));
  for (const [column, treatment] of Object.entries(PUBLIC_TREATMENTS)) {
    lines.push(`  ${column.padEnd(width)}  ${treatment.kind.padEnd(8)}  ${treatment.note}`);
  }

  lines.push('');
  lines.push(`sample rows (first ${String(Math.min(PREVIEW_SAMPLE_ROWS, document.rows.length))} of ${String(document.rows.length)}, exactly as exported):`);

  for (const row of document.rows.slice(0, PREVIEW_SAMPLE_ROWS)) {
    lines.push('  ---');
    for (const [field, value] of Object.entries(row)) {
      lines.push(`    ${field}: ${JSON.stringify(value)}`);
    }
  }

  return { rendered: lines.join('\n'), document };

}
