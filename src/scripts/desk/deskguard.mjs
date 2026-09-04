/**
 * The desk's request guard: decides whether one HTTP request may reach the router at all,
 * before any route runs and before any body is read.
 *
 * A desk trusts every request it accepts, because nothing else stands between a request
 * and its effect: `/input` writes a line the assistant reads as its owner speaking,
 * `/desk-config`'s `gone` list deletes card directories outright, `/questions` drops or
 * answers a pending question, and `/stream` dumps the whole affect log. None of it sits
 * behind a login — the desk's only boundary is "who can reach 127.0.0.1 on this port" —
 * so any web page the owner has open in another tab while a desk runs is a request source
 * exactly as trusted as the desk's own page unless something here says otherwise.
 *
 * Two independent checks compose to close that gap:
 *
 * - **Host** must be the literal `127.0.0.1:<port>` or `localhost:<port>`. This is what
 *   defeats DNS rebinding: an attacker's hostname can be made to resolve to 127.0.0.1, but
 *   the `Host` header a browser sends still names the hostname it was told to fetch, not
 *   the address that name resolved to. A rebound request arrives with a foreign `Host` and
 *   is refused before its `Origin` is even considered.
 *
 * - **Origin**, on any request that changes state (every method but `GET`/`HEAD`) or opens
 *   `/stream` (an `EventSource`, which — unlike a plain navigation — always sends one),
 *   must match the same allowed pair when present at all. A same-origin request always
 *   carries a same-origin value here; a cross-origin one carries the attacker's page, which
 *   cannot be forged from page script. Paired with it, a state-changing request's
 *   `Content-Type` must be exactly `application/json`: that header is not on the CORS
 *   "simple request" safelist, so setting it forces the browser to preflight with `OPTIONS`
 *   first — and this server answers no request, `OPTIONS` included, with an
 *   `Access-Control-Allow-Origin` header, so the preflight fails and the real request is
 *   never sent. That is what closes the `mode:'no-cors'` hole: a `no-cors` request cannot
 *   set `Content-Type` to anything outside the safelist, so it cannot reach a JSON route at
 *   all once the route requires one.
 *
 * @param req  a request-like object exposing `method`, `url`, and `headers` — a real
 *             `http.IncomingMessage` qualifies, and so does a plain object, which is what
 *             lets this run as a pure function with no socket involved
 * @param port the port this desk is actually bound to (not a configured default — the
 *             port it is really listening on, since that is what `Host`/`Origin` compare
 *             against)
 * @returns `{ ok: true }` when the request may proceed, or `{ ok: false, reason }` naming
 *          which check failed (`'host'`, `'origin'`, or `'content-type'`)
 *
 * @example
 * requestAllowed({ method: 'GET', url: '/', headers: { host: '127.0.0.1:7373' } }, 7373);
 * // { ok: true }
 *
 * @example
 * // a cross-origin fetch(url, { mode: 'no-cors', method: 'POST', body }) — text/plain,
 * // Origin forged from the attacker's own page, both refused
 * requestAllowed({
 *   method: 'POST', url: '/desk-config',
 *   headers: { host: '127.0.0.1:7373', origin: 'http://evil.example',
 *              'content-type': 'text/plain;charset=UTF-8' },
 * }, 7373);
 * // { ok: false, reason: 'origin' }
 */
export function requestAllowed(req, port) {
  const headers = req.headers ?? {};
  const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!okHosts.has(headers.host)) return { ok: false, reason: 'host' };

  const method    = String(req.method ?? 'GET').toUpperCase();
  const url       = String(req.url ?? '');
  const mutating  = method !== 'GET' && method !== 'HEAD';
  const streaming = url === '/stream' || url.startsWith('/stream?');

  if (mutating || streaming) {
    const origin = headers.origin;
    if (origin !== undefined) {
      const okOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (!okOrigins.has(origin)) return { ok: false, reason: 'origin' };
    }
  }

  if (mutating) {
    const type = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return { ok: false, reason: 'content-type' };
  }

  return { ok: true };
}
