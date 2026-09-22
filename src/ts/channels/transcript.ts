/**
 * Reading the current turn's first assistant text out of a host transcript.
 *
 * The open-signature check needs the *first* text of the turn, and the Stop payload only
 * carries the *last* one (`last_assistant_message`). Claude Code also sends
 * `transcript_path`, a JSONL file with one entry per message, and that is the only place
 * the first text still exists. So this module reads the transcript — and takes nothing
 * from it except assistant text: user prompts, tool inputs, and tool results are used
 * only as turn boundaries, never returned, never stored.
 *
 * Only the tail of the file is read. A long session's transcript runs to tens of
 * megabytes, and the Stop hook runs on every turn; the current turn is at the end, so a
 * bounded tail answers the question, and a turn too long to fit in it is skipped rather
 * than read in full. Skipping is the fail-open answer, and the open check only warns.
 *
 * @see ../mcp/hooks.js onStop
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** How much of the transcript's end is read, in bytes. */
export const TRANSCRIPT_TAIL_BYTES: number = 2 * 1024 * 1024;

/** A value as a plain object, or `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Whether one parsed transcript entry is a prompt a human typed, which is where a turn
 * begins.
 *
 * A `user` entry is a prompt unless it is harness metadata (`isMeta`), belongs to a
 * subagent (`isSidechain`), or carries a `tool_result` — tool results are recorded as
 * user-role messages, and they are the middle of a turn, not its start.
 *
 * @example
 *   isPromptEntry({ type: 'user', message: { role: 'user', content: 'hi' } })   // => true
 *   isPromptEntry({ type: 'user', message: { content: [{ type: 'tool_result' }] } })   // => false
 */
export function isPromptEntry(entry: Record<string, unknown>): boolean {

  if (entry['type'] !== 'user' || entry['isMeta'] === true || entry['isSidechain'] === true) {
    return false;
  }

  const content = asRecord(entry['message'])?.['content'];

  if (typeof content === 'string') { return true; }
  if (!Array.isArray(content))     { return false; }

  return !content.some(part => asRecord(part)?.['type'] === 'tool_result');

}

/**
 * The text blocks of one assistant entry, joined, or `null` when it has none.
 *
 * @example
 *   assistantText({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
 *   // => 'hi'
 */
export function assistantText(entry: Record<string, unknown>): string | null {

  if (entry['type'] !== 'assistant' || entry['isSidechain'] === true) { return null; }

  const content = asRecord(entry['message'])?.['content'];

  if (typeof content === 'string') { return content.trim() === '' ? null : content; }
  if (!Array.isArray(content))     { return null; }

  const text = content
    .map(part => asRecord(part))
    .filter(part => part?.['type'] === 'text' && typeof part['text'] === 'string')
    .map(part => String(part?.['text']))
    .join('\n');

  return text.trim() === '' ? null : text;

}

/** Parse one JSONL line, or `null` when it is not a JSON object. */
function parseLine(line: string): Record<string, unknown> | null {
  try { return asRecord(JSON.parse(line)); } catch { return null; }
}

/**
 * The first assistant text of the current (last) turn in a transcript, or `null`.
 *
 * `null` means "cannot tell" as well as "none": when no prompt boundary is found — the
 * turn began before the tail that was read — there is no honest answer, and the caller
 * must skip rather than warn.
 *
 * @param jsonl the transcript text, or a tail of it; a partial first line is ignored
 * @returns the text, or `null` when the turn has none or its start is not in view
 *
 * @example
 *   firstAssistantTextOfTurn([
 *     '{"type":"user","message":{"content":"go"}}',
 *     '{"type":"assistant","message":{"content":[{"type":"text","text":"`[9:14 am PDT]` 🙂 `»` still"}]}}',
 *   ].join('\n'))
 *   // => '`[9:14 am PDT]` 🙂 `»` still'
 */
export function firstAssistantTextOfTurn(jsonl: string): string | null {

  const entries = jsonl.split(/\r?\n/u).map(parseLine)
                       .filter((entry): entry is Record<string, unknown> => entry !== null);

  const start = entries.findLastIndex(isPromptEntry);
  if (start === -1) { return null; }

  for (const entry of entries.slice(start + 1)) {
    const text = assistantText(entry);
    if (text !== null) { return text; }
  }

  return null;

}

/**
 * Read at most the last `maxBytes` of a file, or `null` when it cannot be read.
 *
 * @param path     the transcript path the host supplied
 * @param maxBytes how much of the end to read
 *
 * @example
 *   readTail('/home/ada/.claude/projects/x/abc.jsonl')   // => '…{"type":"assistant",…}\n'
 */
export function readTail(path: string, maxBytes: number = TRANSCRIPT_TAIL_BYTES): string | null {

  let fd: number | null = null;

  try {
    fd = openSync(path, 'r');
    const size   = fstatSync(fd).size,
          length = Math.min(size, maxBytes),
          buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
  }

}
