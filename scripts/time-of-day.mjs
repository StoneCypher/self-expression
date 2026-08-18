#!/usr/bin/env node

/**
 * `UserPromptSubmit` hook that tells the assistant what time it is before a turn begins.
 *
 * Wall-clock time is not otherwise available at turn start, so without this the assistant
 * either guesses or silently assumes staleness — and it cannot notice that a request arriving
 * at 02:00 on a Saturday deserves a different tone than the same request at 10:00 on a Tuesday.
 *
 * Reads the hook payload on stdin (and ignores it — the hook needs no input), then writes a
 * `UserPromptSubmit` envelope carrying the timestamp as `additionalContext`. Always exits 0;
 * a clock reading is never a reason to block a prompt.
 *
 * @see https://code.claude.com/docs/en/hooks
 */

/**
 * Coarse label for where a given hour falls in a waking day.
 *
 * Exists so the assistant can reason about likely working context without doing hour
 * arithmetic itself. Boundaries are deliberately conventional rather than configurable;
 * `hour` is a 0-23 local-clock hour.
 *
 * @example
 *   partOfDay(9)  // 'morning'
 *   partOfDay(23) // 'night'
 *   partOfDay(3)  // 'small hours'
 */
const partOfDay = (hour) => {
  if (hour < 5)  { return 'small hours'; }
  if (hour < 12) { return 'morning';     }
  if (hour < 17) { return 'afternoon';   }
  if (hour < 21) { return 'evening';     }
  return 'night';
};

/**
 * Renders a single human-readable sentence describing the moment `now` represents.
 *
 * Produces the exact string handed to the model, so it is written to be skimmed rather than
 * parsed. `now` is the instant to describe, injectable so the renderer stays pure and testable.
 *
 * @example
 *   describeMoment(new Date('2026-08-18T14:05:00'))
 *   // 'Turn starting Tuesday, August 18, 2026 at 2:05 PM (afternoon), timezone America/Los_Angeles.'
 */
const describeMoment = (now) => {

  const date     = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        time     = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return `Turn starting ${date} at ${time} (${partOfDay(now.getHours())}), timezone ${timezone}.`;

};

/**
 * Wraps a context string in the `UserPromptSubmit` hook output envelope.
 *
 * The envelope shape is fixed by the hook protocol; `context` becomes `additionalContext`,
 * which is prepended to the model's view of the turn.
 *
 * @example
 *   envelope('Turn starting Tuesday...')
 *   // { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Turn starting Tuesday...' } }
 */
const envelope = (context) => ({
  hookSpecificOutput: {
    hookEventName    : 'UserPromptSubmit',
    additionalContext: context
  }
});

/**
 * Drains stdin to completion and resolves with the accumulated text.
 *
 * The hook protocol writes its payload to stdin and a well-behaved hook consumes it, so this
 * runs even though the payload is unused. Resolves with an empty string when stdin is closed
 * or empty, and never rejects — a stdin failure must not take the hook down.
 *
 * @example
 *   await readStdin() // '{"hook_event_name":"UserPromptSubmit", ... }'
 */
const readStdin = async () => {

  try {

    const chunks = [];
    for await (const chunk of process.stdin) { chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');

  } catch {

    return '';

  }

};

await readStdin();
process.stdout.write(JSON.stringify(envelope(describeMoment(new Date()))));
process.exit(0);
