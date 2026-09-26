/**
 * Stochastic property tests for host-scoped session resolution (issue #130), run through
 * the real hook handlers and the real `express` handler against a real store.
 *
 * Between two and five simulated hosts share one store. Each one submits prompts,
 * sometimes several in one turn (an interjection) and sometimes after a `/clear` that
 * starts a new session under the same host. Each one also expresses unscoped closes and
 * stops, all in a random interleaving. A tiny model tracks, per host, only what the host
 * itself did: its session, its newest prompt, the first prompt of its current turn, and
 * whether it has closed since that turn began. Two properties must hold for every
 * interleaving:
 *
 * - **stamping.** Every unscoped `express` is stamped with its own host's session and
 *   newest prompt, whatever the other hosts did in between;
 * - **the gate.** A Stop naming either the first or the newest prompt of the turn passes
 *   exactly when that host closed after the turn's newest prompt.
 *
 * One store carries every run of a property. Each run gets its own pid range and session
 * namespace, the same isolation the code itself keys on.
 *
 * @see ../channels/host.js
 * @see ../channels/context.js latestContext
 * @see ../channels/context.js stoppedTurnPrompt
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore } from '../channels/store.js';
import type { Store }            from '../channels/store.js';
import { hookHostIdentity, serverHostIdentity, withHost } from '../channels/host.js';
import { onUserPromptSubmit, onStop } from '../mcp/hooks.js';
import { handleExpress }              from '../mcp/tools.js';

const VERSION = '0.9.0';

/** How many runs each property takes: enough to interleave, cheap enough to keep. */
const RUNS = 60;

/** Every simulated server started here; every event happens after it. */
const START = new Date('2026-09-26T15:00:00Z');

/** One randomized event, as fast-check generates them. */
interface Event {
  readonly kind  : 'prompt' | 'clear' | 'express' | 'stop';
  readonly host  : number;
  /** For a stop: name the turn's first prompt instead of its newest. */
  readonly first : boolean;
}

/** What one host has done, and nothing any other host did. */
interface HostModel {
  session     : string;
  sessions    : number;
  newest      : string | null;
  turnFirst   : string | null;
  closed      : boolean;
}

function eventArb(hosts: number): fc.Arbitrary<Event> {
  return fc.record({
    kind  : fc.constantFrom<Event['kind']>('prompt', 'prompt', 'clear', 'express', 'stop'),
    host  : fc.nat({ max: hosts - 1 }),
    first : fc.boolean(),
  });
}

const scenarioArb = fc.integer({ min: 2, max: 5 })
  .chain(hosts => fc.tuple(fc.constant(hosts), fc.array(eventArb(hosts), { maxLength: 40 })));

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-host-stoch-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** The (session, prompt_id) the newest entry was stamped with. */
function lastStamp(s: Store): [unknown, unknown] {
  const row = s.db.prepare('SELECT session, prompt_id FROM entries ORDER BY id DESC LIMIT 1').get();
  return [row?.['session'], row?.['prompt_id']];
}

/**
 * Replay one scenario and check both properties at every step.
 *
 * @param run a run number, which keeps pids and session names disjoint across runs
 */
function replay(s: Store, run: number, hosts: number, events: readonly Event[]): void {

  const pidOf   = (h: number): number => 10_000 + run * 10 + h,
        hookOf  = (h: number): Store  => withHost(s, hookHostIdentity({ CLAUDE_PID: String(pidOf(h)) }, 7)),
        server  = Array.from({ length: hosts }, (_, h) => withHost(s, serverHostIdentity({}, pidOf(h), START))),
        model   = Array.from({ length: hosts }, (_, h): HostModel =>
          ({ session: `r${String(run)}-h${String(h)}-s0`, sessions: 0, newest: null, turnFirst: null, closed: false }));

  let clock = 0, prompts = 0;
  const tick = (): Date => { clock += 1; return new Date(START.getTime() + clock * 1000); };

  for (const event of events) {

    const h = event.host, m = model[h], srv = server[h];
    if (m === undefined || srv === undefined) { continue; }

    if (event.kind === 'clear' || event.kind === 'prompt') {
      if (event.kind === 'clear') {
        m.sessions += 1;
        m.session   = `r${String(run)}-h${String(h)}-s${String(m.sessions)}`;
        m.turnFirst = null;
        m.closed    = false;
      }
      prompts += 1;
      const prompt = `r${String(run)}-p${String(prompts)}`;
      onUserPromptSubmit(hookOf(h), { session_id: m.session, prompt_id: prompt }, tick());
      m.newest    = prompt;
      m.turnFirst = m.turnFirst ?? prompt;
      // A prompt that arrives after a close reopens the turn: the close is filed under
      // the older prompt, and the work the new one asked for has not been signed.
      m.closed    = false;
      continue;
    }

    if (m.newest === null || m.turnFirst === null) { continue; }   // no turn of its own yet

    if (event.kind === 'express') {
      handleExpress(srv, VERSION, { channel: 'signature', text: 'still; unchanged', position: 'close' });
      expect(lastStamp(s)).toEqual([m.session, m.newest]);
      m.closed = true;
      continue;
    }

    const named = event.first ? m.turnFirst : m.newest,
          out   = onStop(hookOf(h), { session_id: m.session, prompt_id: named });
    expect(out === null).toBe(m.closed);
    // A stop ends the turn only when it passes; a refused stop keeps the same turn going.
    if (out === null) { m.turnFirst = null; m.closed = false; }

  }

}

describe('N hosts sharing one store, in any interleaving', () => {

  it("every unscoped express is stamped with its own host's turn, and the gate agrees", () => {
    withStore(s => {
      let run = 0;
      fc.assert(fc.property(scenarioArb, ([hosts, events]) => {
        run += 1;
        replay(s, run, hosts, events);
      }), { numRuns: RUNS });
    });
  }, 120_000);   // store-backed: the default 5s timeout is a flake margin under a concurrent build, not a correctness bound

});
