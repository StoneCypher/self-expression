/**
 * Tests for the desk panel (`src/scripts/desk/panel.mjs`) and its request guard.
 *
 * `requestAllowed` (`src/scripts/desk/deskguard.mjs`) is tested first as a pure function
 * against plain header objects — no socket needed, per its own contract. The wiring into
 * `panel.mjs` is then tested against a real child process listening on an OS-assigned port
 * (`SELF_EXPRESSION_DESK_PORT=0`), talking to it with real `fetch` calls: the property
 * under test is what a real HTTP client's `text/plain` cross-origin POST can and cannot do
 * to a running desk, which a mocked request object cannot show. That same live panel is
 * what proves the card kit is inlined ahead of the cards, since that is a fact about the
 * page the server assembles rather than about anything it exports.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestAllowed } from '../../scripts/desk/deskguard.mjs';

/** Absolute path of `src/scripts/desk`, the mechanism every desk shares. */
const DESK_SRC = fileURLToPath(new URL('../../scripts/desk', import.meta.url));
const PANEL    = join(DESK_SRC, 'panel.mjs');

describe('requestAllowed', () => {
  const PORT     = 7373;
  const okHost   = `127.0.0.1:${PORT}`;
  const okOrigin = `http://127.0.0.1:${PORT}`;

  test.each([
    ['GET / with the literal host',                 { method: 'GET', url: '/', headers: { host: okHost } },                    true],
    ['GET / with the localhost alias',               { method: 'GET', url: '/', headers: { host: `localhost:${PORT}` } },       true],
    ['GET / with a rebound hostname (DNS rebinding)', { method: 'GET', url: '/', headers: { host: `evil.example:${PORT}` } },    false],
    ['GET / with no Host header at all',             { method: 'GET', url: '/', headers: {} },                                  false],
    ['GET / with the right host but wrong port',     { method: 'GET', url: '/', headers: { host: '127.0.0.1:9999' } },          false],

    ['POST /input, same-origin, application/json',
      { method: 'POST', url: '/input', headers: { host: okHost, origin: okOrigin, 'content-type': 'application/json' } }, true],
    ['POST /input, foreign Origin, application/json',
      { method: 'POST', url: '/input', headers: { host: okHost, origin: 'http://evil.example', 'content-type': 'application/json' } }, false],
    ['POST /input, same-origin, text/plain (the no-cors hole)',
      { method: 'POST', url: '/input', headers: { host: okHost, origin: okOrigin, 'content-type': 'text/plain' } }, false],
    ['POST /input, no Origin header, application/json (a non-browser client)',
      { method: 'POST', url: '/input', headers: { host: okHost, 'content-type': 'application/json' } }, true],
    ['POST /input, application/json with a charset suffix',
      { method: 'POST', url: '/input', headers: { host: okHost, origin: okOrigin, 'content-type': 'application/json; charset=utf-8' } }, true],
    ['OPTIONS preflight to /desk-config',
      { method: 'OPTIONS', url: '/desk-config', headers: { host: okHost, origin: okOrigin } }, false],

    ['GET /stream, same-origin',
      { method: 'GET', url: '/stream', headers: { host: okHost, origin: okOrigin } }, true],
    ['GET /stream, foreign Origin (an EventSource leak)',
      { method: 'GET', url: '/stream', headers: { host: okHost, origin: 'http://evil.example' } }, false],
    ['GET /stream, no Origin header',
      { method: 'GET', url: '/stream', headers: { host: okHost } }, true],

    ['GET /edition, foreign Origin — Origin is not checked on a plain GET',
      { method: 'GET', url: '/edition', headers: { host: okHost, origin: 'http://evil.example' } }, true],
  ])('%s', (_label, req, ok) => {
    expect(requestAllowed(req, PORT).ok).toBe(ok);
  });

  test('names which check failed', () => {
    expect(requestAllowed({ method: 'GET', url: '/', headers: { host: 'nope:1' } }, PORT))
      .toEqual({ ok: false, reason: 'host' });
    expect(requestAllowed({ method: 'POST', url: '/input',
      headers: { host: okHost, origin: 'http://evil.example', 'content-type': 'application/json' } }, PORT))
      .toEqual({ ok: false, reason: 'origin' });
    expect(requestAllowed({ method: 'POST', url: '/input',
      headers: { host: okHost, 'content-type': 'text/plain' } }, PORT))
      .toEqual({ ok: false, reason: 'content-type' });
  });

});

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
   * Start a real `panel.mjs` child process against a fresh scratch desk directory, on an
   * OS-assigned port, and resolve once its own startup log confirms it is listening.
   *
   * @returns the base URL it actually bound to, with no trailing slash
   *
   * @example
   * const base = await startPanel();
   * await fetch(base + '/edition');
   */
  function startPanel(): Promise<string> {
    desk = mkdtempSync(join(tmpdir(), 'se-desk-panel-'));
    return new Promise((settle, fail) => {
      const proc = spawn(process.execPath, [PANEL, desk as string], {
        windowsHide: true,
        env: { ...process.env, SELF_EXPRESSION_DESK_PORT: '0',
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

  test('a text/plain POST from a foreign Origin is refused with 403', async () => {
    const base = await startPanel();
    const res = await fetch(`${base}/desk-config`, {
      method:  'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'http://evil.example' },
      body:    JSON.stringify({ gone: ['some-card'] }),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/forbidden/);
  }, 15000);

  test('a well-formed same-origin JSON POST succeeds', async () => {
    const base = await startPanel();
    const res = await fetch(`${base}/geometry`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body:    JSON.stringify({ w: 800, h: 600, dpr: 1, paneW: 800, paneH: 600 }),
    });
    expect(res.status).toBe(204);
  }, 15000);

  test('the desk page inlines the card kit ahead of the cards', async () => {
    const base = await startPanel();
    const page = await getText(`${base}/desk`);
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
