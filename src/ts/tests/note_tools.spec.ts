/**
 * Specs for the held-note MCP tools and the hook that is their only delivery vehicle
 * (issue #43).
 *
 * The handlers are exercised directly against a real store, with the hook-observed turn
 * context written the way the harness writes it — so "surfacing succeeds only for a turn
 * the hook actually offered on" is checked through the real gate rather than mocked.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }          from '../channels/store.js';
import { recordContext }       from '../channels/context.js';
import { composeNote, noteView, listNotes } from '../channels/notes.js';
import {
  handlePostNote, handleWithdrawNote, handleSurfaceNote, handleListNotes, noteReport,
  NOTES_DISABLED_REPLY,
} from '../mcp/note_tools.js';
import { heldNotesLine, onUserPromptSubmit } from '../mcp/hooks.js';
import { buildServer }         from '../mcp/server.js';

const VERSION = '0.2.1';
const NOW     = new Date('2026-08-28T12:00:00Z');

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-notetools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

function withMailbox<T>(fn: (s: Store) => T): T {
  return withStore(s => { writeConfig(s, 'mailbox.enabled', 'true'); return fn(s); });
}

/** Write the turn context the `UserPromptSubmit` hook would have written. */
function turnContext(s: Store, promptId: string, turn = 'reply'): void {
  recordContext(s, { session: 'sess-1', promptId, turn: turn as never }, NOW);
}

function text(out: { content: { text?: string }[] }): string {
  return String(out.content[0]?.text);
}

function additionalContext(out: unknown): string {
  return String((out as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext);
}

describe('the tools while the facility is off', () => {

  test('every entry point refuses with the same consent-shaped reply', () => withStore(s => {
    expect(text(handlePostNote(s, VERSION, { text: 'x', reason: 'y' }))).toBe(NOTES_DISABLED_REPLY);
    expect(text(handleWithdrawNote(s, { id: 1 }))).toBe(NOTES_DISABLED_REPLY);
    expect(text(handleSurfaceNote(s, { id: 1 }))).toBe(NOTES_DISABLED_REPLY);
    expect(text(handleListNotes(s, {}))).toBe(NOTES_DISABLED_REPLY);
    expect(noteReport(s, 20)).toContain('disabled');
  }));

  test('the tools are registered anyway, so the toggle never flickers a tool in and out', () =>
    withStore(async s => {
      const server = buildServer(s, VERSION, null),
            names  = Object.keys((server as unknown as
              { _registeredTools: Record<string, unknown> })._registeredTools);
      for (const tool of ['post_note', 'withdraw_note', 'surface_note', 'list_notes']) {
        expect(names).toContain(tool);
      }
      await server.close();
    }));

});

describe('post_note', () => {

  test('queues a note and reports the budget it lives under', () => withMailbox(s => {
    const reply = text(handlePostNote(s, VERSION,
      { text: 'run reconcile first', reason: 'the deploy window opens Tuesday' }));
    expect(reply).toContain('queued note #1');
    expect(reply).toContain('1 of 10 pending');
    expect(listNotes(s)).toHaveLength(1);
  }));

  test('adopts the hook-observed session, prompt, and turn rather than inventing them', () =>
    withMailbox(s => {
      turnContext(s, 'p-1', 'wakeup');
      handlePostNote(s, VERSION, { text: 'ripened at 2 am', reason: 'nobody was listening' });
      const row = s.db.prepare('SELECT turn, prompt_id, session FROM note_events').get();
      expect(row).toEqual({ turn: 'wakeup', prompt_id: 'p-1', session: 'sess-1' });
    }));

  test('with no hook context at all the gap is marked, never disguised', () => withMailbox(s => {
    handlePostNote(s, VERSION, { text: 'x', reason: 'y' });
    expect(listNotes(s)[0]?.session).toBe('no-hook');
  }));

  test('a supersede is named in the reply, so a silent replacement is impossible', () =>
    withMailbox(s => {
      handlePostNote(s, VERSION, { text: 'a', reason: 'r', seriesKey: 'k' });
      expect(text(handlePostNote(s, VERSION, { text: 'b', reason: 'r', seriesKey: 'k' })))
        .toContain('supersedes #1');
    }));

  test('an invalid note throws with every problem named, and writes nothing', () => withMailbox(s => {
    expect(() => handlePostNote(s, VERSION, { text: 'x', reason: '' })).toThrow(/reason/);
    expect(listNotes(s)).toHaveLength(0);
  }));

});

describe('surface_note through the real gate', () => {

  test('a note offered this turn surfaces, and the reply states the ceiling honestly', () =>
    withMailbox(s => {
      composeNote(s, { text: 'held', reason: 'r', session: 'sess-1' }, VERSION, NOW);
      turnContext(s, 'p-1');
      onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p-1' }, NOW);

      const reply = text(handleSurfaceNote(s, { id: 1 }));
      expect(reply).toContain('surfaced note #1');
      expect(reply).toContain('never that it was read');
      expect(noteView(s, 1, NOW)?.state).toBe('surfaced');
    }));

  test('a claim about a turn nobody offered on is refused, not recorded', () => withMailbox(s => {
    composeNote(s, { text: 'held', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    turnContext(s, 'p-1');
    expect(() => handleSurfaceNote(s, { id: 1 })).toThrow(/was not offered on this turn/);
    expect(noteView(s, 1, NOW)?.state).toBe('queued');
  }));

  test('with no observed turn at all, nothing can be surfaced', () => withMailbox(s => {
    composeNote(s, { text: 'held', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    expect(() => handleSurfaceNote(s, { id: 1 })).toThrow(/no turn at all/);
  }));

});

describe('withdraw_note and list_notes', () => {

  test('withdrawing names the state it was in and says the exit is terminal', () => withMailbox(s => {
    composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    const reply = text(handleWithdrawNote(s, { id: 1 }));
    expect(reply).toContain("was 'queued'");
    expect(reply).toContain('never be offered again');
  }));

  test('list_notes reports the budgets, the pending count, and the notes themselves', () =>
    withMailbox(s => {
      composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
      const parsed = JSON.parse(text(handleListNotes(s, {}))) as
        { budgets: { offerCap: number }; pending: number; notes: { state: string }[] };
      expect(parsed.budgets.offerCap).toBe(3);
      expect(parsed.pending).toBe(1);
      expect(parsed.notes[0]?.state).toBe('queued');
    }));

  test('the state filter reaches the dead notes too', () => withMailbox(s => {
    composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    handleWithdrawNote(s, { id: 1 });
    const parsed = JSON.parse(text(handleListNotes(s, { state: 'withdrawn' }))) as
      { notes: unknown[] };
    expect(parsed.notes).toHaveLength(1);
  }));

  test('the CLI report renders one line per note', () => withMailbox(s => {
    composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    expect(noteReport(s, 20)).toContain('queued');
    expect(noteReport(s, 20, 'expired')).toBe('no notes.');
  }));

});

describe('heldNotesLine — the only delivery vehicle', () => {

  test('null when the facility is off, whatever is queued', () => withStore(s => {
    writeConfig(s, 'mailbox.enabled', 'true');
    composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    writeConfig(s, 'mailbox.enabled', 'false');
    expect(heldNotesLine(s, 'p-1', 'sess-1', NOW)).toBeNull();
  }));

  test('null when nothing is ripe — the common turn costs nothing', () => withMailbox(s => {
    expect(heldNotesLine(s, 'p-1', 'sess-1', NOW)).toBeNull();
  }));

  test('null with no prompt identity, because nothing could authorize a later surfacing', () =>
    withMailbox(s => {
      composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
      expect(heldNotesLine(s, undefined, 'sess-1', NOW)).toBeNull();
      expect(heldNotesLine(s, '', 'sess-1', NOW)).toBeNull();
    }));

  test('carries the note text with its provenance, and says what to do next', () => withMailbox(s => {
    composeNote(s, { text: 'run reconcile first', reason: 'the deploy window',
                     session: 'sess-1' }, VERSION, NOW);
    const line = heldNotesLine(s, 'p-1', 'sess-1', NOW);
    expect(line).toContain('📬 Held note #1');
    expect(line).toContain('run reconcile first');
    expect(line).toContain('surface_note');
    expect(line).toContain('returns to the queue');
  }));

});

describe('onUserPromptSubmit carries held notes', () => {

  test('a fresh install injects no note segment at all', () => withStore(s => {
    const context = additionalContext(
      onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p-1' }, NOW));
    expect(context).not.toContain('Held note');
    expect(context).toContain('Open this turn with a signature');
  }));

  test('a ripe note rides the line the hook already injects, after the reminder', () =>
    withMailbox(s => {
      composeNote(s, { text: 'held text', reason: 'r', session: 'sess-1' }, VERSION, NOW);
      const context = additionalContext(
        onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p-1' }, NOW));
      expect(context).toContain('Turn starting');
      expect(context).toContain('Open this turn with a signature');
      expect(context).toContain('📬 Held note #1');
      expect(context.indexOf('Open this turn')).toBeLessThan(context.indexOf('📬'));
    }));

  test('the offer is recorded against the hook-supplied reply turn, mechanically', () =>
    withMailbox(s => {
      composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
      onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p-1' }, NOW);
      expect(s.db.prepare("SELECT turn, prompt_id FROM note_events WHERE event = 'offered'").get())
        .toEqual({ turn: 'reply', prompt_id: 'p-1' });
    }));

  test('a note not yet ripe is not offered, and the turn is otherwise unchanged', () =>
    withMailbox(s => {
      composeNote(s, { text: 'x', reason: 'r', session: 'sess-1',
                       notBefore: new Date(NOW.getTime() + 86_400_000).toISOString() },
                  VERSION, NOW);
      const context = additionalContext(
        onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p-1' }, NOW));
      expect(context).not.toContain('Held note');
    }));

  test('a broken note table fails open: the clock and reminder still arrive', () => withMailbox(s => {
    composeNote(s, { text: 'x', reason: 'r', session: 'sess-1' }, VERSION, NOW);
    s.db.exec('DROP TABLE note_events');
    const context = additionalContext(
      onUserPromptSubmit(s, { session_id: 'sess-1', prompt_id: 'p-1' }, NOW));
    expect(context).toContain('Turn starting');
    expect(context).toContain('Open this turn with a signature');
    expect(context).not.toContain('Held note');
  }));

});
