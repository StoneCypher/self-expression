/* cardkit / _feed — the machinery the feed-shaped cards share.
 *
 * `news` and `rss` are the same card twice: fetch XML through the desk's proxy, turn it into
 * rows of {title, link, date, source, summary}, and draw them newest-first. Only the shape of
 * the settings panel and the number of feeds actually differ. Everything that both of them
 * would otherwise have written twice lives here.
 *
 * The browser half is shipped as a SOURCE STRING (`FEED_JS`) because a card's `js` is a classic
 * script, not a module — there is nothing to import from at run time.
 *
 * The string is produced with `Function.prototype.toString()` rather than being hand-written as
 * a quoted blob. That is the whole trick of this file and it is worth stating plainly: a quoted
 * blob has to escape every backslash in every regex, which is where feed parsers go to die, and
 * it cannot be run by a test. Writing the runtime as a real function means the code that ships
 * and the code Node executes are the same characters, so a test of `instantiateFeed()` is a test
 * of what the browser gets.
 */

/* ─────────────────────────────────────────────────────────────────────────────────────────
   The browser runtime
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The entire browser-side feed runtime: parsing, escaping, link vetting, ages, caching and the
 * refresh timer, installed as `window.CKFeed`.
 *
 * Written in classic-script style on purpose — `var` and `function` only, no arrows, no
 * template literals, no optional chaining — because its source is emitted verbatim into a
 * card's `js` and the desk serves that as a plain `<script>`.
 *
 * Every dependency arrives as a parameter rather than being read off the global scope, so Node
 * can hand it a fake `window` and a shim parser and exercise the real code.
 *
 * @param window  the host object; supplies URL, localStorage, setInterval, Promise and CK
 * @param DOMParser  the XML parser constructor; must support the 'application/xml' type
 * @returns the CKFeed API, also assigned to `window.CKFeed`
 *
 * @example
 * var api = feedRuntime(window, DOMParser);
 * api.parse('<rss><channel><item><title>hi</title></item></channel></rss>', {}).items.length; // 1
 */
function feedRuntime(window, DOMParser) {
  var VERSION = 1;

  /* Two feed cards on one desk emit this source twice. Re-running it is harmless but pointless,
     and re-creating the API object would orphan any reference a card already holds. */
  if (window.CKFeed && window.CKFeed.VERSION === VERSION) return window.CKFeed;

  var MIN_REFRESH = 300000;                       // five minutes; the floor, not a suggestion
  var CACHE_PREFIX = 'desk.feed.';
  var TONE_OK = /^var\(--ck-s[1-8]\)$/;           // the only shape a tone may have, see rowHtml

  /* ── text ───────────────────────────────────────────────────────────────────────────── */

  /**
   * HTML-escape a value on its way into markup.
   *
   * A deliberate duplicate of CK.esc rather than a call to it: this runtime is tested in Node
   * without the kit loaded, and a feed parser that cannot escape until some other script has
   * run is a feed parser with a load-order bug waiting in it.
   *
   * @example esc('a<b');   // 'a&lt;b'
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Whitespace runs to single spaces, ends trimmed. Feed text arrives pretty-printed. */
  function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^ | $/g, ''); }

  /* &amp; is decoded LAST. Decoding it first would turn a publisher's '&amp;lt;' into '&lt;'
     and then into '<', manufacturing markup out of text that was correctly encoded. */
  var ENTS = [
    [/&nbsp;/gi, ' '], [/&#0*160;/g, ' '],
    [/&lt;/gi, '<'], [/&gt;/gi, '>'], [/&quot;/gi, '"'],
    [/&apos;/gi, "'"], [/&#0*39;/g, "'"],
    [/&amp;/gi, '&']
  ];

  /**
   * Reduce a feed body to plain text: drop tags, decode the handful of entities publishers
   * still double-encode, collapse the whitespace that leaves behind.
   *
   * Decoding entities here is only safe because nothing this function returns ever reaches the
   * DOM un-escaped — rowHtml runs esc on it afterwards. The order matters: strip, decode,
   * escape. Skipping the final escape would make this function an XSS sink.
   *
   * @example stripTags('<p>a &amp;amp; b</p>');   // 'a &amp; b'
   */
  function stripTags(s) {
    var out = String(s == null ? '' : s).replace(/<[^>]*>/g, ' ');
    for (var i = 0; i < ENTS.length; i++) out = out.replace(ENTS[i][0], ENTS[i][1]);
    /* A tag becomes a space so the words either side of it do not fuse. That leaves a gap in
       front of whatever punctuation followed the tag, so 'with <em>markup</em>.' would read
       'with markup .'. Close those back up rather than ship a card of floating full stops. */
    return collapse(out).replace(/\s+([,.;:!?%)\]}])/g, '$1').replace(/([(\[{])\s+/g, '$1');
  }

  /**
   * Shorten to n characters on a word boundary when there is one worth using.
   *
   * @example clip('one two three', 8);   // 'one two\u2026'
   */
  function clip(s, n) {
    var t = collapse(s);
    if (t.length <= n) return t;
    var cut = t.slice(0, n), sp = cut.lastIndexOf(' ');
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut + '\u2026';
  }

  /**
   * A feed's own title, trimmed to something that fits beside a headline.
   *
   * Publishers append a section to the title ('BBC News - Home'), which is noise once the row
   * is already sitting under that feed's heading.
   *
   * @example shortSource('BBC News - Home');   // 'BBC News'
   */
  function shortSource(s) {
    var t = collapse(s).replace(
      /\s*[-|\u2013\u2014]\s*(home|news|feed|rss|front ?page|headlines|latest|stories|all)\s*$/i, '');
    return t.length > 30 ? t.slice(0, 29) + '\u2026' : t;
  }

  /** FNV-1a, base36. Only used to keep a cache key short; never for anything that must be safe. */
  function hash(s) {
    var h = 2166136261, i, str = String(s);
    for (i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 16777619); }
    return (h >>> 0).toString(36);
  }

  /* ── links ──────────────────────────────────────────────────────────────────────────── */

  /**
   * The URL of a feed item, or '' if it must not become an anchor.
   *
   * A feed is text written by a stranger, and href is the one field in a row where a string
   * from a stranger becomes executable — javascript:, data: and vbscript: all run when
   * clicked. Rather than blacklist those, this allows exactly http: and https: and drops
   * everything else, including relative links that no base can resolve. Callers render the
   * title as plain text when they get '' back; no anchor is better than a live one.
   *
   * Re-vetted at render time as well as at parse time, because rows also arrive from
   * localStorage, which anyone with a devtools window can edit.
   *
   * @param raw   the link text as the feed gave it
   * @param base  the feed's own URL, used to resolve relative links; optional
   * @returns an absolute http(s) URL, or ''
   *
   * @example safeHref('javascript:alert(1)');           // ''
   * @example safeHref('/x', 'https://lobste.rs/rss');   // 'https://lobste.rs/x'
   */
  function safeHref(raw, base) {
    var s = collapse(raw);
    if (!s) return '';
    var u = null;
    try { u = base ? new window.URL(s, base) : new window.URL(s); } catch (e) { return ''; }
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  }

  /** The bare hostname of an http(s) URL, 'www.' dropped, or '' for anything unusable. */
  function hostOf(url) {
    var h = safeHref(url);
    if (!h) return '';
    try { return new window.URL(h).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  /* ── time ───────────────────────────────────────────────────────────────────────────── */

  /**
   * A real Date from whatever the feed called a date, or null.
   *
   * RSS says RFC 822 and Atom says RFC 3339; Date handles both, so the fallback exists only for
   * the feeds that print a bare ISO day and nothing else.
   *
   * @example parseDate('Wed, 27 Aug 2026 09:14:00 GMT').getUTCHours();   // 9
   */
  function parseDate(s) {
    var t = collapse(s);
    if (!t) return null;
    var d = new Date(t);
    if (!isNaN(d.getTime())) return d;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) { d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))); }
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * How long ago, in the shortest honest form: 'now', '14m', '3h', '2d', '5w', '1y'.
   *
   * A date in the future reads as 'now' rather than as a negative age — that is a publisher
   * with a fast clock, not news from tomorrow.
   *
   * @param date  the item's date, or null
   * @param now   milliseconds to measure against; defaults to the wall clock
   *
   * @example age(new Date(Date.now() - 840000));   // '14m'
   */
  function age(date, now) {
    if (!date || isNaN(date.getTime())) return '';
    var ms = (now == null ? Date.now() : now) - date.getTime();
    if (ms < 60000) return 'now';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h';
    if (ms < 604800000) return Math.floor(ms / 86400000) + 'd';
    if (ms < 31536000000) return Math.floor(ms / 604800000) + 'w';
    return Math.floor(ms / 31536000000) + 'y';
  }

  /* ── XML ────────────────────────────────────────────────────────────────────────────── */

  /**
   * Descendants by local name, ignoring namespace prefixes.
   *
   * Feeds mix namespaces freely — dc:date, content:encoded, an Atom document whose entries
   * are prefixed. Matching on local name is the only lookup that survives all of them.
   */
  function tags(node, name) {
    var list = null;
    if (node.getElementsByTagNameNS) list = node.getElementsByTagNameNS('*', name);
    if ((!list || !list.length) && node.getElementsByTagName) list = node.getElementsByTagName(name);
    return list || [];
  }

  /** Direct element children by local name. */
  function kids(node, name) {
    var out = [], list = node.childNodes || [], i, el, ln;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || el.nodeType !== 1) continue;
      ln = String(el.localName || el.nodeName || '').replace(/^.*:/, '');
      if (ln === name) out.push(el);
    }
    return out;
  }

  /**
   * The text of the first of names that has any, preferring direct children.
   *
   * The direct-children pass is not an optimisation. An RSS <item> routinely contains a
   * <media:group><media:title> or an <itunes:summary>; a plain descendant search finds
   * whichever came first in the file, so the item's own title loses at random.
   */
  function pick(node, names) {
    var i, list, t;
    for (i = 0; i < names.length; i++) {
      list = kids(node, names[i]);
      if (list.length) { t = collapse(list[0].textContent); if (t) return t; }
    }
    for (i = 0; i < names.length; i++) {
      list = tags(node, names[i]);
      if (list.length) { t = collapse(list[0].textContent); if (t) return t; }
    }
    return '';
  }

  /** The alternate link of an Atom entry (or the first link with an href), vetted. */
  function atomLink(entry, base) {
    var list = kids(entry, 'link');
    if (!list.length) list = tags(entry, 'link');
    var alt = '', any = '', i, el, rel, href;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      href = el.getAttribute ? (el.getAttribute('href') || '') : '';
      if (!href) continue;
      rel = el.getAttribute ? (el.getAttribute('rel') || '') : '';
      if (!alt && (rel === '' || rel === 'alternate')) alt = href;
      if (!any) any = href;
    }
    return safeHref(alt || any, base);
  }

  /** The link of an RSS item: <link>, falling back to a <guid> that claims to be one. */
  function rssLink(item, base) {
    var href = safeHref(pick(item, ['link']), base);
    if (href) return href;
    var g = kids(item, 'guid');
    if (!g.length) g = tags(item, 'guid');
    if (g.length) {
      var perma = g[0].getAttribute ? g[0].getAttribute('isPermaLink') : null;
      if (perma !== 'false') return safeHref(collapse(g[0].textContent), base);
    }
    return '';
  }

  /**
   * Parse one feed document into rows.
   *
   * Handles RSS 2.0 (<item>), RDF/RSS 1.0 and Atom (<entry>). Never throws: a document that
   * cannot be understood comes back as { items: [], error: '<why>' } so the card can say what
   * went wrong. Rendering nothing and staying silent is the one outcome this must not have —
   * an empty card is indistinguishable from a slow one.
   *
   * Titles are NOT tag-stripped, only summaries are. A headline is displayed as text and
   * escaped on the way in, so markup inside one is harmless; stripping would silently delete a
   * legitimate title like 'Rust 1.90 <breaking changes>'.
   *
   * @param text  the response body
   * @param opts  { url, source } — url resolves relative links, source overrides the
   *              per-row source label when the caller has a nicer name than the feed does
   * @returns { items, error, feedTitle }
   *
   * @example
   * parse(xml, { url: 'https://hnrss.org/frontpage' }).items[0].title;   // 'Show HN: ...'
   */
  function parse(text, opts) {
    var o = opts || {};
    var res = { items: [], error: null, feedTitle: '' };
    var raw = String(text == null ? '' : text);
    if (!collapse(raw)) { res.error = 'the feed returned an empty document'; return res; }

    var doc = null;
    try { doc = new DOMParser().parseFromString(raw, 'application/xml'); }
    catch (e) { res.error = 'could not parse the feed: ' + (e && e.message ? e.message : 'unknown error'); return res; }
    if (!doc) { res.error = 'could not parse the feed: the parser returned no document'; return res; }

    /* Browsers do not throw on malformed XML; they hand back a document whose content is a
       <parsererror> element. Missing this check is how a feed card renders an empty list
       forever and nobody finds out why. */
    var bad = null;
    try { bad = doc.querySelector ? doc.querySelector('parsererror') : null; } catch (e) { bad = null; }
    if (!bad) { var pe = tags(doc, 'parsererror'); bad = pe.length ? pe[0] : null; }
    if (bad) {
      res.error = 'this is not valid XML: ' + clip(collapse(bad.textContent) || 'the parser gave no detail', 160);
      return res;
    }

    var root = doc.documentElement || null;
    var rootName = root ? String(root.localName || root.nodeName || '').replace(/^.*:/, '').toLowerCase() : '';
    var head = null;
    var chan = tags(doc, 'channel');
    head = chan.length ? chan[0] : (root || doc);
    res.feedTitle = shortSource(pick(head, ['title']));

    var list = tags(doc, 'item'), atom = false;
    if (!list.length) { list = tags(doc, 'entry'); atom = list.length > 0; }
    if (!list.length) {
      res.error = (rootName && rootName !== 'rss' && rootName !== 'feed' && rootName !== 'rdf')
        ? 'this does not look like a feed \u2014 its root element is <' + rootName + '>'
        : 'the feed parsed but contains no items';
      return res;
    }

    var base = safeHref(o.url || '');
    var label = collapse(o.source || '');
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      var link = atom ? atomLink(node, base) : rssLink(node, base);
      var when = parseDate(atom ? pick(node, ['updated', 'published', 'issued', 'date'])
                                : pick(node, ['pubDate', 'date', 'updated']));
      var body = atom ? pick(node, ['summary', 'content', 'description'])
                      : pick(node, ['description', 'encoded', 'summary', 'content']);
      res.items.push({
        title: pick(node, ['title']) || (link ? hostOf(link) : 'untitled'),
        link: link,
        date: when,
        source: label || res.feedTitle || hostOf(link) || hostOf(o.url || '') || 'feed',
        summary: stripTags(body)
      });
    }
    return res;
  }

  /* ── rendering ──────────────────────────────────────────────────────────────────────── */

  /** ISO form for a <time datetime>, or '' when there is no usable date. */
  function isoOf(d) { return d && !isNaN(d.getTime()) ? d.toISOString() : ''; }

  /** The long human form for a tooltip, or ''. */
  function fullOf(d) {
    if (!d || isNaN(d.getTime())) return '';
    try { return d.toLocaleString(); } catch (e) { return d.toUTCString(); }
  }

  /**
   * One feed row as markup.
   *
   * Every interpolated value passes through esc, and the only attribute built from feed data
   * is href, which safeHref has already reduced to an absolute http(s) URL or ''. An item
   * with no usable link becomes a <span>: a dead anchor invites a click that does nothing,
   * and a javascript: anchor invites one that does something.
   *
   * tone is matched against TONE_OK before it reaches a style attribute. It is only ever
   * produced by the card from CK.hue, but a style attribute is the other place a string can
   * turn into behaviour, and a regex is cheaper than the argument about whether it can.
   *
   * @param item  a row from parse
   * @param opts  { showSummary, showSource, tone, now }
   *
   * @example rowHtml({ title: 'hi', link: 'https://a.example/', date: new Date() }, {});
   */
  function rowHtml(item, opts) {
    var o = opts || {};
    var href = safeHref(item && item.link);
    var title = collapse(item && item.title) || 'untitled';

    var head = href
      ? '<a class="fd-t" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(title) + '</a>'
      : '<span class="fd-t fd-nolink" title="this item did not offer an http link">' + esc(title) + '</span>';

    var bits = [];
    if (o.showSource !== false && item && item.source) {
      var tone = TONE_OK.test(String(o.tone || '')) ? String(o.tone) : '';
      bits.push('<span class="fd-src">' +
                (tone ? '<i class="fd-dotc" style="background:' + tone + '"></i>' : '') +
                esc(clip(item.source, 30)) + '</span>');
    }
    var a = age(item && item.date, o.now);
    if (a) {
      var iso = isoOf(item.date), full = fullOf(item.date);
      bits.push('<time class="fd-age"' + (iso ? ' datetime="' + esc(iso) + '"' : '') +
                (full ? ' title="' + esc(full) + '"' : '') + '>' + esc(a) + '</time>');
    }
    if (!href) bits.push('<span class="fd-warn">no link</span>');

    var meta = bits.length ? '<div class="fd-m">' + bits.join('<span class="fd-sep">\u00b7</span>') + '</div>' : '';
    var sum = (o.showSummary && item && item.summary)
      ? '<p class="fd-s">' + esc(clip(stripTags(item.summary), 200)) + '</p>' : '';

    return '<li class="fd-row">' + head + meta + sum + '</li>';
  }

  /** Newest first. Undated rows sink to the bottom rather than claiming the epoch. */
  function sortDesc(items) {
    return items.slice().sort(function (a, b) {
      var x = a && a.date ? a.date.getTime() : 0, y = b && b.date ? b.date.getTime() : 0;
      return y - x;
    });
  }

  /* ── cache ──────────────────────────────────────────────────────────────────────────── */

  /** Rows to JSON-safe rows; Date does not survive JSON.stringify as a Date. */
  function dry(items) {
    var out = [], i, it;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      out.push({ title: it.title, link: it.link, date: isoOf(it.date) || null,
                 source: it.source, summary: it.summary });
    }
    return out;
  }

  /**
   * JSON rows back to rows.
   *
   * Every field is coerced to a string and the link is re-vetted by the renderer, because
   * localStorage is not a trusted store — it is a text file the viewer can edit.
   */
  function wet(rows) {
    var out = [], i, r;
    if (!rows || !rows.length) return out;
    for (i = 0; i < rows.length; i++) {
      r = rows[i] || {};
      out.push({ title: String(r.title == null ? '' : r.title),
                 link: String(r.link == null ? '' : r.link),
                 date: r.date ? parseDate(r.date) : null,
                 source: String(r.source == null ? '' : r.source),
                 summary: String(r.summary == null ? '' : r.summary) });
    }
    return out;
  }

  /** The last good result for a key, or null. Never throws: a private window has no store. */
  function cacheGet(key) {
    try {
      var s = window.localStorage.getItem(CACHE_PREFIX + key);
      if (!s) return null;
      var o = JSON.parse(s);
      if (!o || typeof o !== 'object') return null;
      var items = wet(o.items);
      return items.length ? { at: Number(o.at) || 0, items: items } : null;
    } catch (e) { return null; }
  }

  /** Remember a good result. Failure is silent and fine — the card just has no cache. */
  function cacheSet(key, items) {
    try {
      window.localStorage.setItem(CACHE_PREFIX + key,
        JSON.stringify({ at: Date.now(), items: dry(items) }));
    } catch (e) { /* quota, or a browser with storage switched off */ }
  }

  /* ── network ────────────────────────────────────────────────────────────────────────── */

  /**
   * The readable part of a failure from CK.net.
   *
   * The desk's proxy answers a disallowed host with 403 and a body explaining which host and
   * why, and CK.net throws that body as the message. That sentence is the single most useful
   * thing the card can show, so it is passed through rather than replaced by 'could not load'.
   * Only an HTML error page is reduced, and then to its own words, not to a generic one.
   */
  function netError(e) {
    var m = collapse(e && e.message ? e.message : '');
    if (!m) return 'the request failed';
    if (m.charAt(0) === '<') m = collapse(stripTags(m)) || 'the request failed';
    return m;
  }

  /**
   * Fetch and parse one feed. NEVER rejects.
   *
   * A card showing five feeds must not go blank because one of them is down, so every outcome
   * is a value: { ok, url, label, error, items }.
   *
   * @example load('https://lobste.rs/rss', 'Lobsters').then(function (r) { r.ok; });
   */
  function load(url, label) {
    return window.CK.net(url).then(function (text) {
      var r = parse(text, { url: url, source: label });
      if (r.error) return { ok: false, url: url, label: label || hostOf(url) || url, error: r.error, items: [] };
      return { ok: true, url: url, label: label || r.feedTitle || hostOf(url) || url, error: null, items: r.items };
    }, function (e) {
      return { ok: false, url: url, label: label || hostOf(url) || url, error: netError(e), items: [] };
    });
  }

  /** Every feed at once, in one round trip's worth of wall clock. Never rejects. */
  function loadAll(specs) {
    var jobs = [], i;
    for (i = 0; i < specs.length; i++) jobs.push(load(specs[i].url, specs[i].label));
    return window.Promise.all(jobs);
  }

  /**
   * Start the refresh timer for a card, at most once per element and never faster than five
   * minutes.
   *
   * Two things are being defended against. A <main> swap re-runs every builder, so without
   * CK.once a desk left open collects one timer per swap and starts hammering the proxy; and
   * a caller who passes a smaller interval simply does not get it — the floor is enforced here
   * rather than trusted to each card.
   *
   * The timer also stops itself once the card leaves the document, so a dismissed card is not
   * still fetching an hour later.
   *
   * @example schedule(sec, 'refresh', 300000, function () { reload(); });
   */
  function schedule(sec, key, ms, fn) {
    var wait = Math.max(MIN_REFRESH, Number(ms) || 0);
    var guard = (window.CK && window.CK.once)
      ? window.CK.once
      : function (el, k, f) { f(); };
    guard(sec, key, function () {
      var timer = window.setInterval(function () {
        if (!sec.isConnected) { window.clearInterval(timer); return; }
        fn();
      }, wait);
    });
  }

  window.CKFeed = {
    VERSION: VERSION, MIN_REFRESH: MIN_REFRESH,
    esc: esc, collapse: collapse, stripTags: stripTags, clip: clip, shortSource: shortSource,
    hash: hash, safeHref: safeHref, hostOf: hostOf, parseDate: parseDate, age: age,
    parse: parse, rowHtml: rowHtml, sortDesc: sortDesc,
    cacheGet: cacheGet, cacheSet: cacheSet, netError: netError,
    load: load, loadAll: loadAll, schedule: schedule
  };
  return window.CKFeed;
}

/* ─────────────────────────────────────────────────────────────────────────────────────────
   What the cards and the tests use
   ───────────────────────────────────────────────────────────────────────────────────────── */

/** The floor on automatic refresh, in milliseconds. Exported so a card cannot quietly disagree. */
export const MIN_REFRESH_MS = 300000;

/**
 * The browser feed runtime as classic-script source, ready to concatenate into a card's `js`.
 *
 * Self-installing and idempotent: two feed cards on one desk emit this twice and the second
 * copy returns the first one's API rather than replacing it.
 *
 * @example const js = FEED_JS + '\nCK.build("news", function (sec) { ... });';
 */
export const FEED_JS =
  '/* CKFeed \u2014 shared feed runtime, emitted verbatim from cardkit/types/_feed.mjs */\n' +
  '(' + feedRuntime.toString() + ')(window, DOMParser);\n';

/**
 * Run the runtime against a supplied host object instead of a browser.
 *
 * This is what makes the parser testable: Node calls the very function whose source `FEED_JS`
 * ships, so a passing test is evidence about the deployed code and not about a copy of it.
 *
 * @param env  a stand-in `window` — needs URL, DOMParser, localStorage, setInterval, Promise
 * @returns the CKFeed API
 *
 * @example
 * const api = instantiateFeed({ URL, DOMParser: Shim, localStorage: mem, Promise });
 * api.safeHref('javascript:alert(1)');   // ''
 */
export function instantiateFeed(env) {
  return feedRuntime(env, env.DOMParser);
}

/**
 * HTML-escape, Node side, for building a card's static markup.
 *
 * Mirrors CK.esc exactly; a card's title and id come from the desk's config file, which is
 * hand-edited, so they are escaped for the same reason feed text is.
 *
 * @example escHtml('Tom & "Jerry"');   // 'Tom &amp; &quot;Jerry&quot;'
 */
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A card id that is safe to drop into both an attribute and a JS string literal.
 *
 * The id is written into `CK.build('<id>', ...)`, so an id containing a quote would not be an
 * escaping bug, it would be arbitrary code in the emitted script. Rejecting the id outright is
 * the only answer that cannot be got wrong later.
 *
 * @param id  the desk's identifier for this card instance
 * @returns the id, unchanged
 * @throws {TypeError} when the id is not a run of letters, digits, dash or underscore
 *
 * @example safeCardId('news-1');   // 'news-1'
 */
export function safeCardId(id) {
  var s = String(id == null ? '' : id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
    throw new TypeError('card id must be 1-64 chars of [A-Za-z0-9_-]; got ' + JSON.stringify(s));
  }
  return s;
}

/**
 * A value as a JS literal that is safe inside a `<script>` block.
 *
 * `JSON.stringify` alone is not enough: a string containing `</script>` ends the block early,
 * and U+2028/U+2029 are line terminators to a JS parser but not to JSON.
 *
 * @example jsLiteral({ feed: 'https://a/' });   // '{"feed":"https://a/"}'
 */
export function jsLiteral(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The CSS both feed cards need, scoped under whichever card class is asking.
 *
 * Generated rather than copied so the two cards cannot drift apart, and scoped by construction
 * so no rule can escape its card. Colour is only ever a `--` token: this desk is one document
 * rendered in two themes, and a literal is a promise to be wrong in one of them.
 *
 * @param scope  the card's own selector, e.g. '.ck-news'
 * @returns CSS text, every rule prefixed with `scope`
 *
 * @example feedCss('.ck-news').indexOf('.ck-news .fd-row');   // 0 or more
 */
export function feedCss(scope) {
  const s = scope;
  return [
    /* The card box. `position: relative` is what the absolutely-placed gear hangs from. */
    s + ' { position: relative; }',
    s + ' > h2 { font: 600 14px/1.3 var(--disp); color: var(--ink); margin: 0 22px 8px 0; overflow-wrap: anywhere; }',

    s + ' .fd-list { list-style: none; margin: 0; padding: 0; }',
    s + ' .fd-row { padding: 7px 0; border-top: 1px solid var(--hairline); min-width: 0; }',
    s + ' .fd-row:first-child { border-top: 0; padding-top: 2px; }',

    /* Long headlines wrap inside the card. `anywhere` rather than `break-word` because the
       offender is usually one unbroken URL-ish token, which `break-word` still lets overflow. */
    s + ' .fd-t { display: block; max-width: 100%; font: 500 13.5px/1.4 var(--ui); color: var(--ink);' +
        ' text-decoration: none; overflow-wrap: anywhere; }',
    s + ' a.fd-t:hover, ' + s + ' a.fd-t:focus-visible { color: var(--accent); text-decoration: underline; }',
    s + ' .fd-nolink { color: var(--ink-dim); }',

    s + ' .fd-m { display: flex; flex-wrap: wrap; align-items: center; gap: 0 5px; margin-top: 3px;' +
        ' font: 400 10.5px/1.6 var(--mono); color: var(--ink-faint); min-width: 0; }',
    s + ' .fd-src { display: inline-flex; align-items: center; gap: 4px; overflow-wrap: anywhere; }',
    s + ' .fd-dotc { width: 6px; height: 6px; border-radius: 1px; display: block; flex: 0 0 auto; }',
    s + ' .fd-age { color: var(--ink-faint); font-variant-numeric: tabular-nums; }',
    s + ' .fd-sep { color: var(--ink-faint); opacity: .5; }',
    s + ' .fd-warn { color: var(--ink-dim); }',

    s + ' .fd-s { margin: 4px 0 1px; font: 400 11.5px/1.5 var(--ui); color: var(--ink-dim);' +
        ' overflow-wrap: anywhere; }',

    s + ' .fd-group { margin-top: 12px; }',
    s + ' .fd-group:first-child { margin-top: 0; }',
    s + ' .fd-empty { font: 400 12px/1.5 var(--ui); color: var(--ink-dim); padding: 10px 0; }',

    /* Failure and staleness are said in the caption, in the caption's own voice. */
    s + ' .ck-cap .fd-bad { color: var(--accent); }',
    s + ' .ck-cap .fd-stale { color: var(--ink-faint); }',

    /* kit.css stretches every field to the column; a checkbox should not be 200px wide. */
    s + ' .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }',
    s + ' .ck-set textarea { font: 400 11px/1.5 var(--mono); background: var(--ground); color: var(--ink);' +
        ' border: 1px solid var(--rule); border-radius: 4px; padding: 5px 7px; width: 100%;' +
        ' resize: vertical; }',
    s + ' .ck-set textarea:focus { outline: none; border-color: var(--accent); }'
  ].join('\n');
}
