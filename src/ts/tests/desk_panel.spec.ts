/**
 * Tests for the desk panel's request guard.
 *
 * `requestAllowed` (`src/scripts/desk/deskguard.mjs`) is tested first as a pure function
 * against plain header objects — no socket needed, per its own contract. The wiring into
 * `panel.mjs` is then tested against a real child process listening on an OS-assigned port
 * (`SELF_EXPRESSION_DESK_PORT=0`), talking to it with real `fetch` calls: the property
 * under test is what a real HTTP client's `text/plain` cross-origin POST can and cannot do
 * to a running desk, which a mocked request object cannot show.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestAllowed } from '../../scripts/desk/deskguard.mjs';

const PANEL = fileURLToPath(new URL('../../scripts/desk/panel.mjs', import.meta.url));

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

  afterEach(() => {
    child?.kill();
    child = null;
    if (desk) { rmSync(desk, { recursive: true, force: true }); desk = null; }
  });

  /**
   * Start a real `panel.mjs` child process against a fresh scratch desk directory, on an
   * OS-assigned port, and resolve once its own startup log confirms it is listening.
   *
   * @returns the port it actually bound to
   *
   * @example
   * const port = await startPanel();
   * await fetch(`http://127.0.0.1:${port}/edition`);
   */
  function startPanel(): Promise<number> {
    desk = mkdtempSync(join(tmpdir(), 'se-desk-panel-'));
    return new Promise((settle, fail) => {
      const proc = spawn(process.execPath, [PANEL, desk as string], {
        windowsHide: true,
        env: { ...process.env, SELF_EXPRESSION_DESK_PORT: '0',
               SELF_EXPRESSION_AFFECT_LOG: join(desk as string, 'no-such-log.sqlite3') },
      });
      child = proc;
      let out = '';
      const onData = (chunk: Buffer) => {
        out += chunk.toString('utf8');
        const m = /panel: http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
        if (m?.[1]) { proc.stdout.off('data', onData); settle(Number(m[1])); }
      };
      proc.stdout.on('data', onData);
      proc.on('error', fail);
      proc.on('exit', code => {
        if (code !== null && code !== 0) fail(new Error(`panel.mjs exited ${code}: ${out}`));
      });
      setTimeout(() => fail(new Error(`panel.mjs did not report a port in time: ${out}`)), 8000);
    });
  }

  test('a text/plain POST from a foreign Origin is refused with 403', async () => {
    const port = await startPanel();
    const res = await fetch(`http://127.0.0.1:${port}/desk-config`, {
      method:  'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'http://evil.example' },
      body:    JSON.stringify({ gone: ['some-card'] }),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/forbidden/);
  }, 15000);

  test('a well-formed same-origin JSON POST succeeds', async () => {
    const port = await startPanel();
    const res = await fetch(`http://127.0.0.1:${port}/geometry`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body:    JSON.stringify({ w: 800, h: 600, dpr: 1, paneW: 800, paneH: 600 }),
    });
    expect(res.status).toBe(204);
  }, 15000);

});
