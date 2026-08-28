/**
 * Clock formatting for entry timestamps.
 *
 * Every entry stores three time fields rather than one: UTC for ordering and
 * comparison, the rendered local time for reading, and the zone separately. Storing
 * only UTC would make "was this at two in the morning" unanswerable without
 * reconstructing the zone's daylight-saving history, and that question is one of the
 * more interesting ones the log can answer.
 *
 * The previous implementation derived the zone abbreviation by regexing
 * `Date.prototype.toString()` and taking the initials of the parenthesised name.
 * `Intl.DateTimeFormat` reports the abbreviation directly, which is both shorter and
 * correct in the cases where the initials heuristic is not — "Coordinated Universal
 * Time" initialises to `CUT` rather than `UTC`.
 */

/** The three time representations stored on every entry. */
export interface Stamp {
  /** ISO 8601 in UTC; the ordering key. */
  readonly utc: string;
  /** Rendered local time, e.g. `9:14 am PDT`. */
  readonly local: string;
  /** Short zone name, e.g. `PDT`. */
  readonly tz: string;
}

/**
 * The short timezone abbreviation in effect at `when`.
 *
 * Falls back to the IANA zone name, and then to `local`, rather than throwing — a
 * clock reading must never be the reason an entry fails to record.
 *
 * @example
 *   zoneAbbreviation(new Date('2026-08-18T20:14:00Z'))  // => 'PDT' in America/Los_Angeles
 */
export function zoneAbbreviation(when: Date): string {

  try {

    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(when),
          named = parts.find(p => p.type === 'timeZoneName');

    if (named && named.value !== '') { return named.value; }

    return Intl.DateTimeFormat().resolvedOptions().timeZone;

  } catch {

    return 'local';

  }

}

/**
 * Twelve-hour local time without a leading zero, e.g. `9:14 am` or `12:03 pm`.
 *
 * Lowercased because the signature line renders it inline in prose, where `AM` reads
 * as shouting.
 *
 * @example
 *   clockTime(new Date(2026, 7, 18, 9, 14))   // => '9:14 am'
 *   clockTime(new Date(2026, 7, 18, 0, 3))    // => '12:03 am'
 *   clockTime(new Date(2026, 7, 18, 12, 0))   // => '12:00 pm'
 */
export function clockTime(when: Date): string {

  const raw    = when.getHours(),
        suffix = raw >= 12 ? 'pm' : 'am',
        hour   = raw % 12 === 0 ? 12 : raw % 12,
        minute = String(when.getMinutes()).padStart(2, '0');

  return `${String(hour)}:${minute} ${suffix}`;

}

/**
 * Which stretch of the day `when` falls in, in local time.
 *
 * Five buckets rather than a clock reading, because the interesting question is rarely
 * the exact minute — it is whether this is a Tuesday morning or a Saturday at two in the
 * morning. The `small hours` bucket is why the boundary sits at 5 rather than midnight:
 * work at 2 am belongs with the night that preceded it, not with the day that follows.
 *
 * @param when the instant to classify, read in the host's local zone
 *
 * @example
 *   partOfDay(new Date(2026, 7, 18, 14, 5))  // => 'afternoon'
 *   partOfDay(new Date(2026, 7, 18,  2, 0))  // => 'small hours'
 *
 * @see dayPhrase
 */
export function partOfDay(when: Date): string {
  const hour = when.getHours();
  return hour <  5 ? 'small hours'
       : hour < 12 ? 'morning'
       : hour < 17 ? 'afternoon'
       : hour < 21 ? 'evening'
       :             'night';
}

/**
 * A short human phrase naming when something happened — `Saturday evening`.
 *
 * Exists for held-note provenance (#43), where the surfaced note must say when it was
 * written and how long it was held. Weekday-plus-stretch is the right resolution for
 * that: "written Saturday evening, held until Tuesday morning" is legible at a glance,
 * where an ISO instant is not, and the exact instant is a column away for anyone
 * auditing.
 *
 * @param when the instant to describe, read in the host's local zone
 *
 * @example
 *   dayPhrase(new Date(2026, 7, 22, 19, 30))  // => 'Saturday evening'
 *   dayPhrase(new Date(2026, 7, 25,  9,  0))  // => 'Tuesday morning'
 *
 * @see partOfDay
 * @see ./notes.js renderHeldNote
 */
export function dayPhrase(when: Date): string {
  return `${when.toLocaleDateString('en-US', { weekday: 'long' })} ${partOfDay(when)}`;
}

/**
 * All three time fields for a single instant.
 *
 * `when` is injectable so callers and tests can pin the clock; it defaults to now.
 *
 * @example
 *   stamp(new Date('2026-08-18T16:14:00Z'))
 *   // => { utc: '2026-08-18T16:14:00.000Z', local: '9:14 am PDT', tz: 'PDT' }
 */
export function stamp(when: Date = new Date()): Stamp {

  const tz = zoneAbbreviation(when);

  return {
    utc   : when.toISOString(),
    local : `${clockTime(when)} ${tz}`,
    tz,
  };

}
