/**
 * The status-checklist validator: re-derives a rendered checklist's summary arithmetic
 * from its items and reports any mismatch, so the error-prone parts (bucket partition,
 * percent, progress bar, icon lists) are checked mechanically instead of by eye.
 *
 * A careful port of the original skill's `check-checklist.mjs` — the least janky thing
 * in the old plugin — with two deliberate substitutions: the vocabulary comes from
 * `markers.ts` (the promoted single source of truth) instead of re-reading `markers.md`
 * at runtime, and the expected progress bar comes from `scale.ts`'s `barCells` instead
 * of a re-derived boundary rule. Grapheme handling keeps the original's
 * `Intl.Segmenter` clusters rather than naive string indexing, because many markers are
 * multi-code-point (a base emoji plus U+FE0F VARIATION SELECTOR-16).
 *
 * Checks performed:
 *   - every item's marker exists in the canonical vocabulary
 *   - item indentation is exactly 0 / 2 / 4 spaces
 *   - the stated success/active/failure triple partitions the items, with 🛳️ allowed
 *     to count as success or active (completed vs in progress is not knowable from the
 *     glyph)
 *   - percent = round(100 * success / total)
 *   - the 10-cell progress bar matches the percent, including the anti-aliased
 *     boundary cell
 *   - per-marker icon entries (inline after the bar and/or in the icon block below)
 *     match the actual marker counts, and each icon line is sorted by count,
 *     non-increasing, tiebroken by canonical order
 *   - no icon line exceeds 12 entries
 *   - 8-or-fewer distinct markers stay inline; 9+ move to the block below
 *   - block lines are bucket-homogeneous, appear success → active → failure, and are
 *     blank-separated exactly when any bucket wrapped past 12 entries
 *
 * Not checked (documented limitations, inherited from the original): ship-to-targets
 * destination syntax and the optional visuals.
 *
 * Pure: no I/O, no clock, no randomness.
 *
 * @see ./markers.ts
 * @see ./scale.ts
 * @see ./checklist.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */

import { CANONICAL_ORDER, SUCCESS_MARKERS, FAILURE_MARKERS, classifyMarker, canonicalRank } from './markers.js';
import { barCells } from './scale.js';

const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Both presentations of the deploy marker: with the variation selector (as markers.md
// renders it) and the bare code point (as some hosts strip it). Either counts as the
// bucket-flexible ship for partition purposes.
const SHIP_MARKERS: ReadonlySet<string> = new Set(['🛳️', '🛳']);

const VOCABULARY: ReadonlySet<string> = new Set(CANONICAL_ORDER);
const SUCCESS: ReadonlySet<string>    = new Set(SUCCESS_MARKERS);
const FAILURE: ReadonlySet<string>    = new Set(FAILURE_MARKERS);

// The full summary line: count triple, percent, 10-cell bar, then whatever trails it
// (an optional trend sparkline and/or the inline icon list).
const SUMMARY_LINE_RE = /^(\d+)\/(\d+)\/(\d+) items \((\d+)%\) ([█▓▒░]{10})(.*)$/;

// The count-and-percent head alone, for logging: a rendered block whose bar or icon
// list is malformed can still be recorded, matching the original logger's looser parse.
const SUMMARY_HEAD_RE = /^(\d+)\/(\d+)\/(\d+) items \((\d+)%\)/m;

/** First grapheme cluster of a string, or `''` when the string is empty. */
function firstGrapheme(str: string): string {
  for (const { segment } of seg.segment(str)) { return segment; }
  return '';
}

/** All Extended_Pictographic grapheme clusters in a string, in order. */
function pictographs(str: string): string[] {
  const found: string[] = [];
  for (const { segment } of seg.segment(str)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) { found.push(segment); }
  }
  return found;
}

/**
 * The checklist lines out of `text`: the first fenced block's contents when fences
 * exist, otherwise every line.
 *
 * Accepts either a bare checklist block or a Markdown document containing one — the
 * first fence pair wins, matching the original validator's file handling.
 *
 * @example
 *   extractChecklistBlock('intro\n```\n- ✅ done\n```\noutro')  // => ['- ✅ done']
 *   extractChecklistBlock('- ✅ done')                          // => ['- ✅ done']
 */
export function extractChecklistBlock(text: string): string[] {
  const lines    = text.split(/\r?\n/);
  const fenceIdx = lines.reduce<number[]>((acc, l, i) => (l.startsWith('```') ? [...acc, i] : acc), []);
  if (fenceIdx.length >= 2) { return lines.slice((fenceIdx[0] ?? 0) + 1, fenceIdx[1]); }
  return lines;
}

/** The summary triple and percent a checklist block states. */
export interface SummaryCounts {
  readonly success : number;
  readonly active  : number;
  readonly failure : number;
  readonly percent : number;
}

/**
 * The stated `S/A/F items (P%)` head of a checklist block, or `null` when the block
 * carries no parseable summary line.
 *
 * This is the logger's parse — deliberately looser than {@link verifyChecklist}'s full
 * summary-line match, so a block whose bar or icon list is malformed can still be
 * recorded (and separately flagged by the validator). Matches anywhere in the block,
 * like the original `log-checklist.mjs`.
 *
 * @example
 *   parseSummaryCounts('- ✅ a\n- ❌ b\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1')
 *   // => { success: 1, active: 0, failure: 1, percent: 50 }
 *   parseSummaryCounts('- ✅ a')  // => null
 *
 * @see verifyChecklist
 */
export function parseSummaryCounts(block: string): SummaryCounts | null {
  const m = SUMMARY_HEAD_RE.exec(block);
  if (m === null) { return null; }
  return {
    success : Number(m[1]),
    active  : Number(m[2]),
    failure : Number(m[3]),
    percent : Number(m[4]),
  };
}

/** One `<marker> <count>` icon-list entry, as parsed off an icon line. */
type IconEntry = readonly [marker: string, count: number];

/** One icon line: its trimmed text and its parsed entries. */
interface IconLine {
  readonly line    : string;
  readonly entries : readonly IconEntry[];
}

/**
 * Parses `<marker> <count>` entries from a line; `null` when the line is not an icon
 * line (any token that is not exactly one pictographic grapheme followed by a count
 * disqualifies the whole line).
 */
function parseIconLine(line: string): IconEntry[] | null {
  const tokens  = line.trim().split(/\s{2,}/);
  const entries: IconEntry[] = [];
  for (const token of tokens) {
    const m = /^(\S+)\s(\d+)$/u.exec(token);
    if (m === null) { return null; }
    const glyph = m[1] ?? '';
    if (pictographs(glyph).length !== 1 || firstGrapheme(glyph) !== glyph) { return null; }
    entries.push([glyph, Number(m[2])]);
  }
  return entries.length > 0 ? entries : null;
}

/** The bucket an icon-line marker reports to, with 🛳️ kept flexible. */
function bucketOf(marker: string): 'success' | 'active' | 'failure' | 'flex' {
  return SHIP_MARKERS.has(marker) ? 'flex' : classifyMarker(marker);
}

/**
 * The expected 10-cell bar for a stated percent. A stated percent above 100 is already
 * a failed check by itself; render it as a full bar (as the original did) rather than
 * letting `barCells`'s domain guard throw out of a validation pass.
 */
function expectedBar(percent: number): string {
  return percent > 100 ? '█'.repeat(10) : barCells(percent);
}

/** What {@link verifyChecklist} found. */
export interface ChecklistVerification {
  /** `true` exactly when no check failed. */
  readonly ok        : boolean;
  /** How many checklist items were parsed out of the block. */
  readonly itemCount : number;
  /** Every passed check, one `ok: …` line each. */
  readonly passes    : readonly string[];
  /** Every failed check, one `FAIL: …` line each. */
  readonly failures  : readonly string[];
  /**
   * The human-readable report, formatted exactly as the original validator printed:
   * the parsed-item count, every failure, and a closing verdict line.
   */
  readonly report    : string;
}

/**
 * Validates a rendered status checklist against the convention's arithmetic, reporting
 * every mismatch rather than stopping at the first.
 *
 * `text` may be a bare checklist block or a Markdown document containing one fenced
 * block (the first fence pair is used) — see {@link extractChecklistBlock}.
 *
 * @param text the rendered checklist, summary line included
 * @returns every check's outcome plus the formatted report
 *
 * @example
 *   verifyChecklist('- ✅ shipped\n- ❌ broke\n\n1/0/1 items (50%) █████░░░░░  ✅ 1  ❌ 1')
 *   // => { ok: true, itemCount: 2, report: 'ok: 2 items parsed\nok: all checks passed', … }
 *
 * @example
 *   verifyChecklist('- ✅ shipped\n\n1/0/0 items (90%) █████████░  ✅ 1')
 *   // => { ok: false, … }  — the percent says 90 but one success of one item is 100
 *
 * @see ./checklist.ts
 * @see ../../doc_md/reference/status-checklists-skill.md
 */
export function verifyChecklist(text: string): ChecklistVerification {

  const passes:   string[] = [];
  const failures: string[] = [];
  const check = (cond: boolean, okMsg: string, failMsg: string): void => {
    if (cond) { passes.push(`ok: ${okMsg}`); }
    else      { failures.push(`FAIL: ${failMsg}`); }
  };

  const lines = extractChecklistBlock(text);

  const counts = new Map<string, number>();
  let nItems = 0, nSucc = 0, nFail = 0, nShip = 0;

  for (const line of lines) {
    const m = /^( *)- (.+)$/.exec(line);
    if (m === null) { continue; }
    const indent = m[1] ?? '';
    const body   = m[2] ?? '';
    nItems += 1;
    check([0, 2, 4].includes(indent.length),
      `indent ${String(indent.length)} valid: ${body.slice(0, 30)}`,
      `bad indent ${String(indent.length)} (must be 0/2/4): ${body.slice(0, 60)}`);
    const marker = firstGrapheme(body);
    check(VOCABULARY.has(marker),
      `marker ${marker} known`,
      `unknown marker ${marker} on: ${body.slice(0, 60)}`);
    counts.set(marker, (counts.get(marker) ?? 0) + 1);
    if      (SHIP_MARKERS.has(marker)) { nShip += 1; }
    else if (SUCCESS.has(marker))      { nSucc += 1; }
    else if (FAILURE.has(marker))      { nFail += 1; }
  }

  let summary: RegExpExecArray | null = null;
  let summaryIndex = -1;
  for (const [i, line] of lines.entries()) {
    const m = SUMMARY_LINE_RE.exec(line);
    if (m !== null) { summary = m; summaryIndex = i; break; }
  }

  if (summary === null) {
    failures.push('FAIL: no summary line found (expected `S/A/F items (P%) <10-cell bar>`)');
  } else {
    const [S, A, F, P] = [Number(summary[1]), Number(summary[2]), Number(summary[3]), Number(summary[4])];
    const bar  = summary[5] ?? '';
    const rest = summary[6] ?? '';

    check(S + A + F === nItems,
      `count section ${String(S)}/${String(A)}/${String(F)} sums to ${String(nItems)} items`,
      `count section ${String(S)}/${String(A)}/${String(F)} sums to ${String(S + A + F)}, but ${String(nItems)} items were parsed`);

    // 🛳️ may legitimately sit in either bucket; accept any consistent split.
    const shipsToSuccess = S - nSucc;
    const bucketOk = shipsToSuccess >= 0 && shipsToSuccess <= nShip
      && F === nFail
      && A === nItems - S - nFail;
    check(bucketOk,
      `bucket partition consistent (computed ${String(nSucc)}+${String(nShip)}🛳️ / ${String(nFail)} fail)`,
      `bucket mismatch: items imply success ${String(nSucc)}–${String(nSucc + nShip)}, failure ${String(nFail)}; stated ${String(S)}/${String(A)}/${String(F)}`);

    const expP = nItems === 0 ? Number.NaN : Math.round((100 * S) / nItems);
    check(P === expP, `percent ${String(P)}% matches`, `percent ${String(P)}% stated, ${String(expP)}% computed`);
    check(bar === expectedBar(P),
      `bar matches ${String(P)}%`,
      `bar ${bar} stated, ${expectedBar(P)} expected for ${String(P)}%`);

    // Icon entries: inline remainder (minus any trend sparkline) plus icon lines
    // below, grouped by blank-line separation for the structure checks.
    const stated = new Map<string, number>();
    const inline = rest.replace(/\s{2}trend [▁▂▃▄▅▆▇█]+/u, '').trim();
    const inlineEntries = inline === '' ? null : parseIconLine(inline);
    if (inline !== '' && inlineEntries === null) {
      failures.push(`FAIL: malformed inline icon entries: ${inline}`);
    }

    const groups: IconLine[][] = [];
    let current: IconLine[] = [];
    for (const line of lines.slice(summaryIndex + 1)) {
      const entries = parseIconLine(line);
      if (entries !== null) { current.push({ line: line.trim(), entries }); }
      else if (current.length > 0) { groups.push(current); current = []; }
    }
    if (current.length > 0) { groups.push(current); }

    const allLines: IconLine[] = [
      ...(inlineEntries !== null ? [{ line: inline, entries: inlineEntries }] : []),
      ...groups.flat(),
    ];
    for (const { line, entries } of allLines) {
      check(entries.length <= 12,
        'icon line within 12 entries',
        `icon line has ${String(entries.length)} entries (max 12): ${line.slice(0, 40)}`);
      const sorted = entries.every(([mk, n], i) => {
        if (i === 0) { return true; }
        const [pmk, pn] = entries[i - 1] ?? ['', 0];
        if (pn !== n) { return pn > n; }
        return canonicalRank(pmk) <= canonicalRank(mk);
      });
      check(sorted,
        `icon line sorted (count desc, canonical tiebreak): ${line.slice(0, 30)}`,
        `icon line order wrong (count desc, then canonical order): ${line}`);
      for (const [mk, n] of entries) { stated.set(mk, (stated.get(mk) ?? 0) + n); }
    }

    if (stated.size === 0) {
      failures.push('FAIL: no per-marker icon entries found');
    } else {
      check(stated.size <= 8 ? (groups.length === 0) : (inlineEntries === null && groups.length > 0),
        `${String(stated.size)} distinct markers placed ${stated.size <= 8 ? 'inline' : 'in the block below'}`,
        stated.size <= 8
          ? `${String(stated.size)} distinct markers (≤8) must be inline on the summary line, not a block below`
          : `${String(stated.size)} distinct markers (≥9) must move to a block below the bar, not inline`);

      // Block structure: each line one bucket, buckets in order, blank separation
      // exactly when some bucket wrapped past one line.
      const ORDER = ['success', 'active', 'failure'];
      const lineBuckets = groups.map(group => group.map(({ line, entries }) => {
        const concrete = [...new Set(entries.map(([mk]) => bucketOf(mk)))].filter(b => b !== 'flex');
        check(concrete.length <= 1,
          `icon line bucket-homogeneous: ${line.slice(0, 30)}`,
          `icon line mixes buckets (${concrete.join('+')}): ${line}`);
        return concrete[0] ?? 'flex';
      }));
      const flatBuckets = lineBuckets.flat().filter(b => b !== 'flex');
      const inOrder = flatBuckets.every((b, i) =>
        i === 0 || ORDER.indexOf(flatBuckets[i - 1] ?? '') <= ORDER.indexOf(b));
      if (groups.length > 0) {
        check(inOrder,
          'bucket lines in success → active → failure order',
          `bucket lines out of order: ${flatBuckets.join(', ')}`);
      }
      const wrapped = flatBuckets.some((b, i) => i > 0 && flatBuckets[i - 1] === b);
      if (groups.length > 0) {
        check(
          wrapped ? lineBuckets.every(g => new Set(g.filter(b => b !== 'flex')).size <= 1)
                  : groups.length === 1,
          wrapped ? 'wrapped buckets blank-separated' : 'unwrapped bucket lines adjacent',
          wrapped ? 'a bucket wrapped, so every bucket group must be blank-separated'
                  : 'no bucket wrapped, so bucket lines must sit adjacent with no blank lines');
      }

      for (const [mk, n] of counts) {
        check(stated.get(mk) === n,
          `icon ${mk} ${String(n)}`,
          `icon ${mk}: stated ${String(stated.get(mk) ?? 'missing')}, actual ${String(n)}`);
      }
      for (const mk of stated.keys()) {
        if (!counts.has(mk)) { failures.push(`FAIL: icon ${mk} listed but no such item exists`); }
      }
    }
  }

  const verdict = failures.length === 0
    ? 'ok: all checks passed'
    : `${String(failures.length)} check(s) FAILED (${String(passes.length)} passed)`;

  const report = [`ok: ${String(nItems)} items parsed`, ...failures, verdict].join('\n');

  return { ok: failures.length === 0, itemCount: nItems, passes, failures, report };

}
