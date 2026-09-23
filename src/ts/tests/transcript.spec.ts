import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir }                             from 'node:os';
import { join }                               from 'node:path';

import {
  firstAssistantTextOfTurn, isPromptEntry, assistantText, readTail,
} from '../channels/transcript.js';

/** One transcript line, as Claude Code writes it. */
const user      = (content: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content }, ...extra });
const text      = (t: string): { type: string; text: string } => ({ type: 'text', text: t });
const toolUse   = { type: 'tool_use', id: 't1', name: 'express', input: { text: 'SECRET INPUT' } };
const toolRes   = { type: 'tool_result', tool_use_id: 't1', content: 'recorded #4' };

const OPEN = '`[9:14 am PDT]` 🙂 🧭 `»` still; fresh start';

describe('firstAssistantTextOfTurn', () => {

  test('returns the first text of the last turn, not of an earlier one', () => {
    const jsonl = [
      user('first prompt'),
      assistant([text('old turn text')]),
      user('second prompt'),
      assistant([toolUse]),
      user([toolRes]),
      assistant([text(`${OPEN}\n\nworking on it`)]),
      assistant([text('later text')]),
    ].join('\n');
    expect(firstAssistantTextOfTurn(jsonl)).toBe(`${OPEN}\n\nworking on it`);
  });

  test('a tool result is the middle of a turn, not its start', () => {
    const jsonl = [
      user('go'),
      assistant([text('opening words'), toolUse]),
      user([toolRes]),
      assistant([text('after the tool')]),
    ].join('\n');
    expect(firstAssistantTextOfTurn(jsonl)).toBe('opening words');
  });

  test('meta and sidechain entries are neither boundaries nor answers', () => {
    const jsonl = [
      user('real prompt'),
      user('<system-reminder>injected</system-reminder>', { isMeta: true }),
      assistant([text('subagent chatter')], { isSidechain: true }),
      user('subagent prompt', { isSidechain: true }),
      assistant([text('the real first text')]),
    ].join('\n');
    expect(firstAssistantTextOfTurn(jsonl)).toBe('the real first text');
  });

  test('never returns tool inputs or user words, even when no text exists', () => {
    const jsonl = [user('please'), assistant([toolUse]), user([toolRes])].join('\n');
    expect(firstAssistantTextOfTurn(jsonl)).toBeNull();
  });

  test('cannot tell when no prompt boundary is in view', () => {
    expect(firstAssistantTextOfTurn(assistant([text('orphan')]))).toBeNull();
  });

  test('a partial first line and junk lines are ignored', () => {
    const jsonl = ['e":"half a line"}', 'not json', user('go'), assistant([text('ok')])].join('\n');
    expect(firstAssistantTextOfTurn(jsonl)).toBe('ok');
  });

});

describe('entry predicates', () => {

  test('isPromptEntry accepts string and text-array prompts, rejects the rest', () => {
    expect(isPromptEntry(JSON.parse(user('hi')) as Record<string, unknown>)).toBe(true);
    expect(isPromptEntry(JSON.parse(user([text('hi')])) as Record<string, unknown>)).toBe(true);
    expect(isPromptEntry(JSON.parse(user([toolRes])) as Record<string, unknown>)).toBe(false);
    expect(isPromptEntry(JSON.parse(assistant('hi')) as Record<string, unknown>)).toBe(false);
    expect(isPromptEntry({ type: 'user', message: {} })).toBe(false);
  });

  test('assistantText joins text blocks and ignores tool calls', () => {
    const entry = JSON.parse(assistant([text('a'), toolUse, text('b')])) as Record<string, unknown>;
    expect(assistantText(entry)).toBe('a\nb');
    expect(assistantText(JSON.parse(assistant('plain')) as Record<string, unknown>)).toBe('plain');
    expect(assistantText(JSON.parse(assistant([toolUse])) as Record<string, unknown>)).toBeNull();
  });

});

describe('readTail', () => {

  test('reads only the end of the file, and null when unreadable', () => {
    const dir  = mkdtempSync(join(tmpdir(), 'se-transcript-')),
          path = join(dir, 't.jsonl');
    try {
      writeFileSync(path, `${'x'.repeat(1000)}\nTAIL`);
      expect(readTail(path, 4)).toBe('TAIL');
      expect(readTail(path)).toContain('TAIL');
      expect(readTail(join(dir, 'missing.jsonl'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
