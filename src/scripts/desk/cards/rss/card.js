/* CKFeed — shared feed runtime, emitted verbatim from cardkit/types/_feed.mjs */
(function feedRuntime(window, DOMParser) {
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
})(window, DOMParser);

CK.build("rss", function (sec) {
  var F = window.CKFeed;
  var DEF = {"feeds":"https://hnrss.org/frontpage\nhttps://lobste.rs/rss\nhttps://www.theregister.com/headlines.atom\nhttps://feeds.bbci.co.uk/news/technology/rss.xml","count":10,"group":"source"};
  var COUNTS = [5,10,20];
  var MAX_FEEDS = 12;
  var bodyEl = sec.querySelector(".fd-body");
  var capEl = sec.querySelector(".ck-cap");

  var state = { feeds: [], rows: [], failed: [], stale: [], rejected: [],
                at: 0, busy: false, key: "", cached: false };

  /* Selects report type "select-one", so CK.settings stores their value as a string; the
     coercion also survives a hand-edited localStorage entry saying "count": "lots". */
  function howMany(c) {
    var n = Number(c && c.count), i;
    for (i = 0; i < COUNTS.length; i++) if (COUNTS[i] === n) return n;
    return DEF.count;
  }

  function grouping(c) { return (c && c.group === "source") ? "source" : "time"; }

  /* One line per feed. Blank lines and # comments are skipped; anything that is not an
     http(s) URL is collected and named in the caption rather than dropped in silence. */
  function feedsOf(c) {
    var raw = c && c.feeds != null ? String(c.feeds) : "";
    var lines = raw.split(/[\r\n]+/);
    var out = [], bad = [], seen = {}, i, t, u;
    for (i = 0; i < lines.length; i++) {
      t = F.collapse(lines[i]);
      if (!t || t.charAt(0) === "#") continue;
      u = F.safeHref(t);
      if (!u) { bad.push(t); continue; }
      if (Object.hasOwn(seen, u)) continue;
      seen[u] = 1;
      out.push({ url: u, label: "" });
      if (out.length >= MAX_FEEDS) break;
    }
    return { feeds: out, rejected: bad };
  }

  function keyFor(url) { return "rss." + sec.dataset.card + "." + F.hash(url); }

  /* Colour identifies a source, so it is assigned from the alphabetical list of sources
     rather than from arrival order. Otherwise every new story would reshuffle the dots. */
  function tones(rows) {
    var names = [], map = {}, i, n;
    for (i = 0; i < rows.length; i++) {
      n = rows[i].source || "unknown";
      if (!Object.hasOwn(map, n)) { map[n] = true; names.push(n); }
    }
    names.sort();
    for (i = 0; i < names.length; i++) map[names[i]] = CK.hue(i);
    return map;
  }

  function listHtml(rows, tone) {
    var html = "", i;
    for (i = 0; i < rows.length; i++) {
      html += F.rowHtml(rows[i], {
        showSource: true,
        tone: tone[rows[i].source || "unknown"] || "",
        showSummary: false
      });
    }
    return "<ol class=\"fd-list\">" + html + "</ol>";
  }

  function bySource(rows) {
    var order = [], bag = {}, i, n;
    for (i = 0; i < rows.length; i++) {
      n = rows[i].source || "unknown";
      if (!Object.hasOwn(bag, n)) { bag[n] = []; order.push(n); }
      bag[n].push(rows[i]);
    }
    /* rows arrive newest-first, so each bag is already sorted and bag[0] is its newest. */
    order.sort(function (a, b) {
      var x = bag[a][0].date ? bag[a][0].date.getTime() : 0;
      var y = bag[b][0].date ? bag[b][0].date.getTime() : 0;
      return y - x;
    });
    return { order: order, bag: bag };
  }

  function render(c) {
    if (!bodyEl) { caption(c); return; }
    var rows = F.sortDesc(state.rows);
    var tone = tones(rows);
    var n = howMany(c);
    var html = "";
    if (!rows.length) {
      html = "<div class=\"fd-empty\">" +
             (state.busy ? "fetching\u2026" : "nothing to show yet") + "</div>";
    } else if (grouping(c) === "source") {
      var g = bySource(rows), i;
      for (i = 0; i < g.order.length; i++) {
        html += "<div class=\"fd-group\"><div class=\"ck-h3\">" +
                F.esc(F.clip(g.order[i], 34)) + "</div>" +
                listHtml(g.bag[g.order[i]].slice(0, n), tone) + "</div>";
      }
    } else {
      html = listHtml(rows.slice(0, n), tone);
    }
    bodyEl.innerHTML = html;
    caption(c);
  }

  function ago(ms) { var a = F.age(new Date(ms)); return a === "now" ? "just now" : a + " ago"; }

  function caption(c) {
    if (!capEl) return;
    var n = howMany(c);
    var shown = grouping(c) === "source" ? state.rows.length : Math.min(state.rows.length, n);
    var live = state.feeds.length;
    var line = "<b>" + F.esc(String(shown)) + "</b> " + (shown === 1 ? "item" : "items") +
               " from <b>" + F.esc(String(live)) + "</b> " + (live === 1 ? "feed" : "feeds");
    if (state.busy) line += " <span class=\"ck-aside\">fetching\u2026</span>";
    else if (state.at) line += " <span class=\"ck-aside\">" + F.esc(ago(state.at)) + "</span>";

    if (state.cached && state.at) {
      line += "<div class=\"fd-stale\">drawn from the last saved copy, from " +
              F.esc(ago(state.at)) + "</div>";
    } else if (state.stale.length) {
      line += "<div class=\"fd-stale\">saved copies shown for " +
              F.esc(state.stale.join(", ")) + "</div>";
    }

    /* Each failure keeps the words the server or the parser used. A 403 from the proxy
       names the host and says why it is not allowed, and that sentence is the only thing
       that tells the viewer what to do next. */
    var i;
    for (i = 0; i < state.failed.length; i++) {
      line += "<div class=\"fd-bad\">" + F.esc(state.failed[i].label) + ": " +
              F.esc(state.failed[i].error) + "</div>";
    }
    if (state.rejected.length) {
      line += "<div class=\"fd-bad\">not http or https, so skipped: " +
              F.esc(F.clip(state.rejected.join(", "), 160)) + "</div>";
    }
    if (!state.feeds.length) {
      line += "<div class=\"fd-bad\">no feeds set \u2014 open the gear and add one per line</div>";
    }
    capEl.innerHTML = line;
  }

  /* Every feed at once. loadAll never rejects, so one dead host costs one source and
     never the whole card. */
  function reload(c) {
    if (state.busy || !state.feeds.length) { render(c); return; }
    state.busy = true;
    render(c);
    F.loadAll(state.feeds).then(function (rs) {
      var merged = [], failed = [], stale = [], i, r, hit;
      for (i = 0; i < rs.length; i++) {
        r = rs[i];
        if (r.ok && r.items.length) {
          F.cacheSet(keyFor(r.url), r.items);
          merged = merged.concat(r.items);
        } else {
          failed.push({ label: r.label, error: r.error || "the feed had no items" });
          hit = F.cacheGet(keyFor(r.url));
          if (hit) { merged = merged.concat(hit.items); stale.push(r.label); }
        }
      }
      state.busy = false;
      state.rows = merged;
      state.failed = failed;
      state.stale = stale;
      state.cached = false;
      state.at = Date.now();
      render(c);
    }, function (e) {
      state.busy = false;
      state.failed = [{ label: "all feeds", error: F.netError(e) }];
      render(c);
    });
  }

  function apply(c) {
    var got = feedsOf(c);
    var urls = [], i;
    for (i = 0; i < got.feeds.length; i++) urls.push(got.feeds[i].url);
    var key = F.hash(urls.join(" "));
    state.rejected = got.rejected;
    if (key === state.key) { render(c); return; }

    state.key = key;
    state.feeds = got.feeds;
    state.failed = []; state.stale = []; state.rows = []; state.at = 0; state.cached = false;

    /* Paint whatever was saved last time before going near the network, so a swap or a
       reload never shows an empty card while the fetches are in flight. */
    var newest = 0, hit;
    for (i = 0; i < got.feeds.length; i++) {
      hit = F.cacheGet(keyFor(got.feeds[i].url));
      if (!hit) continue;
      state.rows = state.rows.concat(hit.items);
      if (hit.at > newest) newest = hit.at;
    }
    if (state.rows.length) { state.cached = true; state.at = newest; }
    render(c);
    reload(c);
  }

  var conf = CK.settings(sec, DEF, apply);
  F.schedule(sec, "feeds", 300000, function () { reload(conf.get()); });
});
