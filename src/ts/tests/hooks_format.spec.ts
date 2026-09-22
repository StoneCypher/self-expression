import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { fromMarkdown }        from 'mdast-util-from-markdown';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { recordEntry }                        from '../channels/entries.js';
import { recentFindings }                     from '../channels/findings.js';
import { signatureLineFor }                   from '../channels/signature_line.js';
import {
  onUserPromptSubmit, onStop, handleHook, stopOutput, mergeOutcomes, guarded,
  NO_OUTCOME, CLOSE_RECORD_REASON,
} from '../mcp/hooks.js';
import type { HookPayload, StopDeps } from '../mcp/hooks.js';

const VERSION = '0.7.1';
const NOW     = new Date(2026, 8, 22, 9, 14);
const TURN    = { session_id: 'sess-1', prompt_id: 'p1' } as const;
const parse   = (text: string) => fromMarkdown(text);

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-hookfmt-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Start the turn, record its close, and return the line `express` would hand back. */
function signedTurn(s: Store, text = 'flow; clear plan'): string {
  onUserPromptSubmit(s, TURN, NOW);
  const written = recordEntry(s, { channel: 'signature', text, session: 'sess-1', promptId: 'p1',
                                   position: 'close', face: '🙂', contextEmoji: '🧭' }, VERSION, NOW);
  return signatureLineFor(s, written.id) ?? '';
}

/** Stop the turn with a final message and optional extras. */
function stop(s: Store, message: string | undefined, extra: Partial<HookPayload> = {},
              deps: StopDeps = { parse }): ReturnType<typeof onStop> {
  return onStop(s, { ...TURN, ...(message === undefined ? {} : { last_assistant_message: message }),
                     ...extra }, { now: NOW, ...deps });
}

/** A transcript whose current turn begins with `first`. */
function transcript(first: string): string {
  return [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant',
                     content: [{ type: 'text', text: first }] } }),
  ].join('\n');
}

describe('onStop — the visible close line', () => {

  test('a message ending in the recorded line passes', () => withStore(s => {
    const line = signedTurn(s);
    expect(stop(s, `All done.\n\n${line}\n\n`)).toBeNull();
    expect(recentFindings(s)).toEqual([]);
  }));

  test('a recorded close with no visible line blocks, quoting the exact line to paste', () => withStore(s => {
    const line = signedTurn(s),
          out  = stop(s, 'All done. Nothing else to add.');
    expect(out?.['decision']).toBe('block');
    expect(String(out?.['reason'])).toContain(line);
    expect(String(out?.['reason'])).toContain('as the last line');
    expect(recentFindings(s)[0]).toMatchObject({
      check_name: 'close-line', kind: 'close-line-missing', action: 'blocked', session: 'sess-1', prompt_id: 'p1',
    });
  }));

  test('a line whose text differs from the record blocks as a mismatch', () => withStore(s => {
    signedTurn(s, 'flow; clear plan');
    const out = stop(s, 'Done.\n\n`[9:14 am PDT]` 🙂 `»` drag; a different mood');
    expect(out?.['decision']).toBe('block');
    expect(recentFindings(s)[0]).toMatchObject({ kind: 'close-line-mismatch' });
  }));

  test('the line must be last — a signature followed by more prose does not count', () => withStore(s => {
    const line = signedTurn(s);
    expect(stop(s, `${line}\n\nOne more thing.`)?.['decision']).toBe('block');
  }));

  test('the text comparison forgives whitespace, not wording', () => withStore(s => {
    signedTurn(s, 'flow; clear plan');
    expect(stop(s, '`[9:14 am PDT]` 🙂   🧭 `»`  flow;  clear plan ')).toBeNull();
  }));

  test('gate.signature_line = false turns the check off', () => withStore(s => {
    signedTurn(s);
    writeConfig(s, 'gate.signature_line', false);
    expect(stop(s, 'no line at all')).toBeNull();
  }));

  test('no final message means nothing to check — fail open', () => withStore(s => {
    signedTurn(s);
    expect(stop(s, undefined)).toBeNull();
    expect(stop(s, '   ')).toBeNull();
  }));

  test('with no close recorded, the record gate speaks and the line check stays quiet', () => withStore(s => {
    onUserPromptSubmit(s, TURN, NOW);
    const out = stop(s, 'finished, but never signed');
    expect(out?.['reason']).toBe(CLOSE_RECORD_REASON);
    expect(recentFindings(s)).toEqual([]);
  }));

  test('the stop_hook_active loop breaker still wins over every check', () => withStore(s => {
    signedTurn(s);
    expect(stop(s, '1. a\n2. b', { stop_hook_active: true })).toBeNull();
  }));

});

describe('onStop — the list lint', () => {

  const LIST_MESSAGE = 'Options:\n\n1. rebase\n2. merge\n3. squash\n\n';

  test('report mode (the default) logs the violation and never blocks', () => withStore(s => {
    const line = signedTurn(s);
    expect(stop(s, `${LIST_MESSAGE}${line}`)).toBeNull();
    expect(recentFindings(s)[0]).toMatchObject({
      check_name: 'lists', kind: 'ordered-list', severity: 'violation', action: 'reported',
      items: 3, line: 3, excerpt: '1. rebase',
    });
  }));

  test('block mode refuses the stop for a numbered list', () => withStore(s => {
    const line = signedTurn(s);
    writeConfig(s, 'gate.lists', 'block');
    const out = stop(s, `${LIST_MESSAGE}${line}`);
    expect(out?.['decision']).toBe('block');
    expect(String(out?.['reason'])).toContain('number-square');
    expect(recentFindings(s)[0]).toMatchObject({ action: 'blocked' });
  }));

  test('block mode still only logs a bullet list', () => withStore(s => {
    const line = signedTurn(s);
    writeConfig(s, 'gate.lists', 'block');
    expect(stop(s, `- one\n- two\n\n${line}`)).toBeNull();
    expect(recentFindings(s)[0]).toMatchObject({ kind: 'bullet-list', severity: 'warning', action: 'reported' });
  }));

  test('off mode inspects nothing', () => withStore(s => {
    const line = signedTurn(s);
    writeConfig(s, 'gate.lists', 'off');
    expect(stop(s, `${LIST_MESSAGE}${line}`)).toBeNull();
    expect(recentFindings(s)).toEqual([]);
  }));

  test('in block mode, a message of code full of numbered lines and YAML dashes passes', () => withStore(s => {
    const line = signedTurn(s);
    writeConfig(s, 'gate.lists', 'block');
    const message = [
      'The workflow now reads:', '',
      '```yaml', 'jobs:', '  build:', '    steps:', '      - uses: actions/checkout@v4',
      '      - run: npm ci', '      - run: npm test', '```', '',
      '```text', '1. clean', '2. test', '3. bundle', '```', '',
      '```diff', '- need: which branch? 😟', '+ 💡 cache the install 🤩', '```', '',
      '    1. indented', '    2. code', '',
      'Inline `1. a` stays inline.', '',
      '> 1. a quoted', '> 2. list', '',
      line,
    ].join('\n');
    expect(stop(s, message)).toBeNull();
    expect(recentFindings(s)).toEqual([]);
  }));

  test('no parser supplied means no lint — the binary degrades rather than failing', () => withStore(s => {
    const line = signedTurn(s);
    writeConfig(s, 'gate.lists', 'block');
    expect(stop(s, `${LIST_MESSAGE}${line}`, {}, {})).toBeNull();
    expect(recentFindings(s)).toEqual([]);
  }));

  test('a parser that throws costs the lint and nothing else', () => withStore(s => {
    onUserPromptSubmit(s, TURN, NOW);   // unsigned, so the record gate must still speak
    const out = stop(s, LIST_MESSAGE, {}, { parse: () => { throw new Error('parser bug'); } });
    expect(out?.['reason']).toBe(CLOSE_RECORD_REASON);
  }));

  test('every refusal rides one block, because there is only ever one', () => withStore(s => {
    signedTurn(s);
    writeConfig(s, 'gate.lists', 'block');
    const reason = String(stop(s, LIST_MESSAGE)?.['reason']);
    expect(reason).toContain('does not end with its visible line');
    expect(reason).toContain('number-square');
  }));

});

describe('onStop — the open line (warn only)', () => {

  function recordOpen(s: Store, text: string): string {
    const written = recordEntry(s, { channel: 'signature', text, session: 'sess-1', promptId: 'p1',
                                     position: 'open', face: '🙂' }, VERSION, NOW);
    return signatureLineFor(s, written.id) ?? '';
  }

  /** Stop a signed turn whose transcript starts with `first`. */
  function stopWithTranscript(s: Store, closeLine: string, first: string): ReturnType<typeof onStop> {
    return stop(s, `done\n\n${closeLine}`, { transcript_path: '/t.jsonl' },
                { parse, readTranscript: () => transcript(first) });
  }

  test('a rendered and recorded open passes silently', () => withStore(s => {
    const openLine  = recordOpen(s, 'still; fresh'),
          closeLine = signedTurn(s);
    expect(stopWithTranscript(s, closeLine, `${openLine}\n\nLooking now.`)).toBeNull();
  }));

  test('no open at all warns the user and logs, but never blocks', () => withStore(s => {
    const out = stopWithTranscript(s, signedTurn(s), 'Looking now.');
    expect(out?.['decision']).toBeUndefined();
    expect(String(out?.['systemMessage'])).toContain('without an open signature');
    expect(recentFindings(s)[0]).toMatchObject({ check_name: 'open-line', kind: 'open-missing', action: 'warned' });
  }));

  test('a recorded open that was never rendered warns', () => withStore(s => {
    recordOpen(s, 'still; fresh');
    const out = stopWithTranscript(s, signedTurn(s), 'Looking now.');
    expect(recentFindings(s)[0]).toMatchObject({ kind: 'open-line-missing' });
    expect(out?.['decision']).toBeUndefined();
  }));

  test('a rendered open that was never recorded warns', () => withStore(s => {
    const out = stopWithTranscript(s, signedTurn(s), '`[9:14 am PDT]` 🙂 `»` still; fresh');
    expect(String(out?.['systemMessage'])).toContain('never recorded');
    expect(recentFindings(s)[0]).toMatchObject({ kind: 'open-record-missing' });
  }));

  test('a rendered open that differs from the record warns', () => withStore(s => {
    recordOpen(s, 'still; fresh');
    stopWithTranscript(s, signedTurn(s), '`[9:14 am PDT]` 🙂 `»` spark; something else');
    expect(recentFindings(s)[0]).toMatchObject({ kind: 'open-mismatch' });
  }));

  test('a warning rides alongside a block without becoming one', () => withStore(s => {
    signedTurn(s);
    const out = stop(s, 'no close line', { transcript_path: '/t.jsonl' },
                     { parse, readTranscript: () => transcript('no open line') });
    expect(out?.['decision']).toBe('block');
    expect(String(out?.['systemMessage'])).toContain('open signature');
  }));

  test('gate.open_line = false, no transcript, or an unreadable one: nothing', () => withStore(s => {
    const closeLine = signedTurn(s);
    expect(stop(s, `done\n\n${closeLine}`)).toBeNull();                        // no path
    expect(stop(s, `done\n\n${closeLine}`, { transcript_path: '/t.jsonl' },
                { readTranscript: () => null })).toBeNull();                   // unreadable
    writeConfig(s, 'gate.open_line', false);
    expect(stopWithTranscript(s, closeLine, 'no open')).toBeNull();            // off
    expect(recentFindings(s)).toEqual([]);
  }));

});

describe('stop output plumbing', () => {

  test('stopOutput: nothing is null, warnings alone are a systemMessage', () => {
    expect(stopOutput(NO_OUTCOME)).toBeNull();
    expect(stopOutput({ blocks: [], warnings: ['a.', 'b.'], findings: [] }))
      .toEqual({ systemMessage: 'self-expression: a. b.' });
    expect(stopOutput({ blocks: ['x', 'y'], warnings: [], findings: [] }))
      .toEqual({ decision: 'block', reason: 'x\n\ny' });
  });

  test('mergeOutcomes keeps order; guarded turns a throw into nothing', () => {
    const merged = mergeOutcomes([
      { blocks: ['1'], warnings: [], findings: [] },
      guarded(() => { throw new Error('boom'); }),
      { blocks: ['2'], warnings: ['w'], findings: [] },
    ]);
    expect(merged.blocks).toEqual(['1', '2']);
    expect(merged.warnings).toEqual(['w']);
  });

  test('handleHook passes the parser through to the stop hook', () => withStore(s => {
    const line = signedTurn(s);
    writeConfig(s, 'gate.lists', 'block');
    const payload = { ...TURN, last_assistant_message: `1. a\n2. b\n\n${line}` };
    expect(handleHook('stop', s, payload, NOW, { parse })?.['decision']).toBe('block');
    expect(handleHook('stop', s, payload, NOW)).toBeNull();   // no parser: lint skipped
  }));

});
