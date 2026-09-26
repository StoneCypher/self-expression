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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
   * The child never reaches the real GitHub: `SELF_EXPRESSION_DESK_GH` names a program that
   * does not exist, so any `gh` run fails exactly the way a machine without `gh` does, and an
   * inherited `SELF_EXPRESSION_DESK_REPO` is removed so the test decides the repo.
   *
   * @param files desk-relative paths to write before the server starts, with their contents
   * @param env   extra environment for the child
   * @returns the base URL it actually bound to, with no trailing slash
   *
   * @example
   * const base = await startPanel({ 'desk-config.json': '{"repo":"o/r"}' });
   * await fetch(base + '/prs');
   */
  function startPanel(files: Record<string, string> = {}, env: Record<string, string> = {}): Promise<string> {
    desk = mkdtempSync(join(tmpdir(), 'se-desk-panel-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(desk, name), body);
    const inherited = { ...process.env };
    delete inherited['SELF_EXPRESSION_DESK_REPO'];
    return new Promise((settle, fail) => {
      const proc = spawn(process.execPath, [PANEL, desk as string], {
        windowsHide: true,
        env: { ...inherited, SELF_EXPRESSION_DESK_PORT: '0',
               SELF_EXPRESSION_AFFECT_LOG: join(desk as string, 'no-such-log.sqlite3'),
               SELF_EXPRESSION_DESK_GH: 'se-no-such-gh-binary-134', ...env },
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

  /**
   * POST a JSON body the way the desk's own page does.
   *
   * @param base the panel's base URL
   * @param path the route
   * @param body the value to send
   * @returns the response
   */
  function postJson(base: string, path: string, body: unknown): Promise<Response> {
    return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base },
                                body: JSON.stringify(body) });
  }

  /**
   * The desk's audit log as parsed rows.
   *
   * @returns every row, oldest first; `[]` when nothing has been audited
   */
  function auditRows(): Record<string, unknown>[] {
    let text = '';
    try { text = readFileSync(join(desk as string, 'audit.jsonl'), 'utf8'); } catch { /* none yet */ }
    return text.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
  }

  test('the desk page carries both pull-request lists and the ticket rail', async () => {
    const page = await getText(`${await startPanel()}/desk`);
    for (const id of ['prminewrap', 'prmine', 'prtheirwrap', 'prtheir', 'prnote', 'ticketwrap', 'ticketlist']) {
      expect(page).toContain(`id="${id}"`);
    }
    /* The repo is served, never baked into the page. */
    expect(page).not.toMatch(/repo:\s*'[^']+\/[^']+'/);
  }, 15000);

  test('/prs with no repo configured says so rather than going blank', async () => {
    const base = await startPanel();
    const res  = await fetch(`${base}/prs`);
    expect(res.status).toBe(200);
    const got = await res.json() as Record<string, unknown>;
    expect(got).toEqual(expect.objectContaining({ repo: null, mine: [], theirs: [] }));
    expect(got['error']).toMatch(/no repo configured/);
  }, 15000);

  test('/prs with a repo but no gh says gh is missing', async () => {
    const base = await startPanel({ 'desk-config.json': JSON.stringify({ repo: 'StoneCypher/self-expression' }) });
    const got  = await (await fetch(`${base}/prs`)).json() as Record<string, unknown>;
    expect(got).toEqual(expect.objectContaining({ repo: 'StoneCypher/self-expression', mine: [], theirs: [] }));
    expect(got['error']).toBe('gh is not installed or not on PATH (se-no-such-gh-binary-134)');
  }, 15000);

  test('SELF_EXPRESSION_DESK_REPO overrides the desk config', async () => {
    const base = await startPanel({ 'desk-config.json': JSON.stringify({ repo: 'cfg/repo' }) },
                                  { SELF_EXPRESSION_DESK_REPO: 'env/repo' });
    const got  = await (await fetch(`${base}/prs`)).json() as Record<string, unknown>;
    expect(got['repo']).toBe('env/repo');
  }, 15000);

  test('a PR intent is recorded in the config and the audit log, and nothing else changes', async () => {
    const base = await startPanel({ 'desk-config.json': JSON.stringify({ name: 'mine', hidden: ['weather'] }) });
    expect((await postJson(base, '/pr', { number: 135, action: 'land' })).status).toBe(204);
    expect((await postJson(base, '/pr', { number: 136, action: 'drop' })).status).toBe(204);
    const cfg = JSON.parse(readFileSync(join(desk as string, 'desk-config.json'), 'utf8')) as Record<string, unknown>;
    expect(cfg).toEqual({ name: 'mine', hidden: ['weather'], prIntent: { 135: 'land' }, prHidden: [136] });
    expect(auditRows()).toEqual([
      expect.objectContaining({ action: 'pr.intent', number: 135, intent: 'land', note: 'recorded only; no GitHub write' }),
      expect.objectContaining({ action: 'pr.intent', number: 136, intent: 'drop' }),
    ]);

    /* A rename from the page merges rather than replaces, so the intents survive it. */
    expect((await postJson(base, '/desk-config', { name: 'renamed' })).status).toBe(204);
    const after = JSON.parse(readFileSync(join(desk as string, 'desk-config.json'), 'utf8')) as Record<string, unknown>;
    expect(after).toEqual(expect.objectContaining({ name: 'renamed', prIntent: { 135: 'land' }, prHidden: [136] }));
  }, 15000);

  test('a PR intent that is not one of the three verbs is refused, audited, and not written', async () => {
    const base = await startPanel();
    expect((await postJson(base, '/pr', { number: 135, action: 'merge' })).status).toBe(400);
    expect((await postJson(base, '/pr', { number: 'x', action: 'land' })).status).toBe(400);
    expect(() => readFileSync(join(desk as string, 'desk-config.json'))).toThrow();
    expect(auditRows().map(r => r['action'])).toEqual(['pr.intent.refused', 'pr.intent.refused']);
  }, 15000);

  test('/open refuses anything but a permalink, audits it, and /audit shows it', async () => {
    const base = await startPanel();
    /* Only refusals are exercised here: an accepted permalink would open a real browser. */
    expect((await postJson(base, '/open', { url: 'file:///C:/Windows/System32' })).status).toBe(400);
    expect((await postJson(base, '/open', { url: 'https://example.com/a/b/issues/1' })).status).toBe(400);
    const got = await (await fetch(`${base}/audit?n=5`)).json() as { rows: Record<string, unknown>[]; showing: number };
    expect(got.showing).toBe(2);
    expect(got.rows.map(r => r['action'])).toEqual(['open.refused', 'open.refused']);
  }, 15000);

  test('answering keeps the ticket bench, and dropping a ticket promotes the next', async () => {
    const inbox = {
      questions: [{ id: 'q', text: 'ok?' }, { id: 'k', kind: 'ticket', text: '#134 restore the inbox' }],
      reserve:   [{ id: 'r', kind: 'ticket', text: '#140 next' }],
    };
    const base = await startPanel({ 'questions.json': JSON.stringify(inbox) });
    const read = () => JSON.parse(readFileSync(join(desk as string, 'questions.json'), 'utf8')) as typeof inbox;

    expect((await postJson(base, '/questions', { id: 'q', answer: 'yes' })).status).toBe(204);
    expect(read().reserve).toEqual(inbox.reserve);
    expect(read().questions[0]).toEqual(expect.objectContaining({ id: 'q', answer: 'yes' }));

    expect((await postJson(base, '/questions', { id: 'k', action: 'drop' })).status).toBe(204);
    expect(read().questions.map(q => q.id)).toEqual(['q', 'r']);
    expect(read().reserve).toEqual([]);

    const served = await (await fetch(`${base}/questions`)).json() as { questions: { id: string }[] };
    expect(served.questions.map(q => q.id)).toEqual(['q', 'r']);
  }, 15000);

});
