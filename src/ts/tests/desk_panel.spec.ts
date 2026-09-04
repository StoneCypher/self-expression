/**
 * Tests for the desk panel server (`src/scripts/desk/panel.mjs`).
 *
 * `panel.mjs` is a `createServer` script, not a module of exported functions — its whole
 * contract is what it serves over HTTP. So these tests boot a real child process against a
 * fresh scratch desk directory, on a `SELF_EXPRESSION_DESK_PORT` picked at random per run
 * (the panel's own default, 7373, is a real desk's port — port 0 is not used here because
 * `PORT = Number(env) || 7373` treats "0" as absent and falls back to the default), and talk
 * to it with real `fetch` calls rather than importing anything from it.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of `src/scripts/desk`, the mechanism every desk shares. */
const DESK_SRC = fileURLToPath(new URL('../../scripts/desk', import.meta.url));
const PANEL    = join(DESK_SRC, 'panel.mjs');

describe('panel.mjs, over a real socket', () => {

  let child: ChildProcessWithoutNullStreams | null = null;
  let desk:  string | null = null;

  /* The panel holds recursive `watch` handles on its desk directory for the lifetime of the
     process, so removing that directory while the child is still alive is a race: on Windows the
     open handles make `rmSync` fail outright, and everywhere else the dying watcher can fire
     against paths that no longer exist. `kill()` only *requests* the exit — waiting for the
     `exit` event is what makes the teardown ordered rather than hopeful. A child that has already
     exited never emits it again, hence the `exitCode`/`signalCode` check before the wait. */
  afterEach(async () => {
    const proc = child;
    child = null;
    if (proc !== null) {
      if (proc.exitCode === null && proc.signalCode === null) {
        await new Promise<void>(done => { proc.once('exit', () => { done(); }); proc.kill(); });
      }
    }
    if (desk) { rmSync(desk, { recursive: true, force: true }); desk = null; }
  });

  /**
   * Start a real `panel.mjs` child process against a fresh scratch desk directory, on a
   * randomly chosen port, and resolve once its own startup log confirms it is listening.
   *
   * @returns the base URL it actually bound to, with no trailing slash
   *
   * @example
   * const base = await startPanel();
   * await fetch(base + '/edition');
   */
  function startPanel(): Promise<string> {
    desk = mkdtempSync(join(tmpdir(), 'se-desk-panel-'));
    const port = 20000 + Math.floor(Math.random() * 20000);   // clear of the real desk's 7373
    return new Promise((settle, fail) => {
      const proc = spawn(process.execPath, [PANEL, desk as string], {
        windowsHide: true,
        env: { ...process.env, SELF_EXPRESSION_DESK_PORT: String(port),
               SELF_EXPRESSION_AFFECT_LOG: join(desk as string, 'no-such-log.sqlite3') },
      });
      child = proc;
      let out = '';
      /* Cleared the moment the port is reported. Left pending it keeps the event loop alive for
         its full eight seconds after a test that has already passed, which is time added to every
         run of this file for a deadline that can no longer fire usefully. */
      const deadline = setTimeout(
        () => { fail(new Error(`panel.mjs did not report a port in time: ${out}`)); }, 8000);
      const onData = (chunk: Buffer) => {
        out += chunk.toString('utf8');
        const m = /panel: http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
        if (m?.[1]) {
          clearTimeout(deadline);
          proc.stdout.off('data', onData);
          settle(`http://127.0.0.1:${m[1]}`);
        }
      };
      proc.stdout.on('data', onData);
      proc.on('error', fail);
      proc.on('exit', code => {
        clearTimeout(deadline);
        if (code !== null && code !== 0) fail(new Error(`panel.mjs exited ${code}: ${out}`));
      });
    });
  }

  /**
   * GET one URL from a running panel and return its body as text.
   *
   * @param url the full URL to fetch
   * @returns the response body
   *
   * @example
   * await getText(base + '/desk');   // the assembled desk page
   */
  async function getText(url: string): Promise<string> {
    const res = await fetch(url);
    return res.text();
  }

  test('the desk page inlines the card kit ahead of the cards', async () => {
    const base = await startPanel();
    const page = await getText(base + '/desk');
    const kitCss = readFileSync(join(DESK_SRC, 'cardkit', 'kit.css'), 'utf8').slice(0, 80);
    const kitJs  = readFileSync(join(DESK_SRC, 'cardkit', 'kit.js'),  'utf8').slice(0, 80);
    expect(page).toContain(kitCss);
    expect(page).toContain(kitJs);
    /* 'DESK.inits.forEach' occurs twice: inside `deskSwap`'s definition (self-renewal,
       fires only on a later hot-swap) and, at the very end of the page, the unconditional
       "first paint" call that runs every builder once the document is ready. It is the
       second — `lastIndexOf` — that kit.js must precede: that call needs the kit's runtime
       already defined, exactly as it needs every card's own script already defined. */
    expect(page.indexOf(kitJs)).toBeLessThan(page.lastIndexOf('DESK.inits.forEach'));
  }, 15000);

});
