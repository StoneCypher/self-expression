/* cardkit / rss — many feeds, one river.
 *
 * The difference from `news` is not the number of URLs, it is what the card is for. `news` is a
 * front page: one editor's judgement, in their order. This is a reading queue: every source
 * flattened into one reverse-chronological list, each row wearing a tag saying where it came
 * from, so 'what is new anywhere' is a single glance rather than five.
 *
 * Two consequences follow, and both are load-bearing:
 *
 *  - Feeds are fetched in parallel, so the card costs one round trip rather than five.
 *  - A feed that fails is a missing SOURCE, never a missing CARD. Its last good items are
 *    served from cache if there are any, its name goes in the caption with the reason it gave,
 *    and the other four render exactly as they would have. A card that blanks itself because
 *    one host had a bad afternoon is a card nobody trusts again.
 */

import {
  FEED_JS, MIN_REFRESH_MS, escHtml, feedCss, jsLiteral, safeCardId
} from './_feed.mjs';

/** How many rows: overall when grouping by time, per source when grouping by source. */
const COUNTS = [5, 10, 20];

/** The two orders that are actually useful. Anything else is a sort, not a grouping. */
const GROUPS = [
  { value: 'time',   label: 'time (one river)' },
  { value: 'source', label: 'source' }
];

/**
 * A starting set: two RSS feeds and one Atom feed, all on the desk server's allowlist.
 *
 * Mixed formats on purpose — a viewer who never edits this still exercises both parsers, so a
 * regression in either shows up on the desk rather than in a bug report.
 */
const DEFAULT_FEEDS = [
  'https://hnrss.org/frontpage',
  'https://lobste.rs/rss',
  'https://www.theregister.com/headlines.atom'
].join('\n');

/** No more than this many feeds, however many lines are pasted in. See `normalize`. */
const MAX_FEEDS = 12;

const DEFAULTS = { feeds: DEFAULT_FEEDS, count: 10, group: 'time' };

/**
 * What this card type is, for the desk's type picker.
 *
 * `shape` is the one-line data literal a caller would write; `defaults` is the machine-readable
 * half, every setting with its fallback. The keys are the same in both because the panel and the
 * desk file configure the same card — `feeds` is the one that differs in form, since a file
 * naturally writes an array and a textarea naturally produces newline-separated text, and
 * `normalize` accepts either.
 */
export const meta = {
  name: 'rss',
  summary: 'Many feeds merged into one reverse-chronological list, each row tagged with its source.',
  shape: '{ feeds, count, group } — feeds an array or newline-separated http(s) URLs (at most 12), count 5 | 10 | 20, group "time" | "source"',
  defaults: { ...DEFAULTS }
};

/**
 * Settle a raw `data` block into something the card can run.
 *
 * `feeds` accepts either an array or the newline-separated text the panel produces, because a
 * hand-written desk file naturally wants a list and a textarea naturally produces a string.
 * Bad lines are dropped here AND reported at run time; silently swallowing a typo'd URL is how
 * a viewer ends up convinced a feed is dead.
 *
 * The 12-feed cap exists because a card is a card: twelve parallel fetches is already a
 * generous read of 'one round trip', and the desk's proxy is one process.
 *
 * @param data  the raw `data` block; may be undefined
 *
 * @example normalize({ feeds: ['https://lobste.rs/rss'], group: 'source' }).group;   // 'source'
 */
function normalize(data) {
  const d = data && typeof data === 'object' ? data : {};

  const lines = Array.isArray(d.feeds) ? d.feeds
    : typeof d.feeds === 'string' ? d.feeds.split(/[\r\n]+/)
    : [];
  const kept = [];
  for (const line of lines) {
    const t = String(line == null ? '' : line).trim();
    if (!t || t.startsWith('#')) continue;
    if (!/^https?:\/\/\S+$/i.test(t)) continue;
    if (kept.indexOf(t) < 0) kept.push(t);
    if (kept.length >= MAX_FEEDS) break;
  }

  const count = COUNTS.indexOf(Number(d.count)) >= 0 ? Number(d.count) : DEFAULTS.count;
  const group = GROUPS.some((g) => g.value === d.group) ? d.group : DEFAULTS.group;

  return { feeds: kept.length ? kept.join('\n') : DEFAULTS.feeds, count, group };
}

/**
 * The card's markup: heading, gear, settings, the body, the caption.
 *
 * The gear is emitted with no content whatsoever — `CK.settings` only fills it when
 * `gear.firstChild` is null, and a newline between the tags is already a text node.
 *
 * The textarea is left empty rather than pre-filled: `CK.settings` reflects the settled value
 * onto every named field when it wires up, so markup carrying a default would be a second
 * source of truth that could disagree with the first.
 */
function htmlFor(id, title, ord) {
  const counts = COUNTS.map((n) => '<option value="' + n + '">' + n + '</option>').join('');
  const groups = GROUPS
    .map((g) => '<option value="' + escHtml(g.value) + '">' + escHtml(g.label) + '</option>')
    .join('');

  return [
    '<section data-card="' + escHtml(id) + '" class="ck-rss" data-ord="' + escHtml(String(ord)) + '">',
    '<h2>' + escHtml(title) + '</h2>',
    '<button class="ck-gear" title="settings" aria-label="settings"></button>',
    '<div class="ck-set" hidden>',
      '<label for="' + escHtml(id) + '-feeds">feeds</label>',
      '<textarea id="' + escHtml(id) + '-feeds" name="feeds" rows="4" spellcheck="false"' +
        ' autocomplete="off" placeholder="one URL per line"></textarea>',
      '<label for="' + escHtml(id) + '-count">show</label>',
      '<select id="' + escHtml(id) + '-count" name="count">' + counts + '</select>',
      '<label for="' + escHtml(id) + '-group">group by</label>',
      '<select id="' + escHtml(id) + '-group" name="group">' + groups + '</select>',
      '<div class="ck-set-foot">At most ' + MAX_FEEDS + ' feeds, refreshed together every five' +
        ' minutes. Grouped by source, “show” counts per source. Hosts must be on the desk' +
        ' server’s allowlist; anything else comes back refused, with the reason.</div>',
    '</div>',
    '<div class="fd-body" aria-live="polite"></div>',
    '<div class="ck-cap">waiting for the first fetch…</div>',
    '</section>'
  ].join('');
}

/**
 * The card's CSS: the shared feed rules plus what only a merged list needs.
 *
 * No literal colour appears here or anywhere in this file's output. The source dots take their
 * colour from `CK.hue`, which returns a `--ck-s*` token, so even the one decorative colour on
 * the card is a token the theme controls.
 */
function cssFor() {
  return [
    feedCss('.ck-rss'),
    /* A source tag is an identifier, not a sentence: it never wraps to a second line and never
       pushes the row wider than the card. */
    '.ck-rss .fd-src { max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.ck-rss .fd-group > .ck-h3 { margin: 0 0 4px; }',
    '.ck-rss .fd-group + .fd-group { border-top: 1px solid var(--hairline); padding-top: 10px; }',
    /* Settings rows are top-aligned because one of the fields is four lines tall. */
    '.ck-rss .ck-set { align-items: start; }',
    '.ck-rss .ck-set label { padding-top: 5px; }'
  ].join('\n');
}

/**
 * The card's browser script.
 *
 * Classic-script style throughout, concatenated after `FEED_JS` so `window.CKFeed` exists by
 * the time `CK.build` runs the body.
 *
 * Two decisions worth knowing before reading it:
 *
 *  - The cache is per FEED, not per card. That is what lets a dead source keep showing its last
 *    good items while its neighbours update, which is the whole promise of the card.
 *  - A settings change re-fetches only when the set of URLs changed. Changing the count or the
 *    grouping re-renders rows already in hand, so a cosmetic toggle cannot be used to get round
 *    the five-minute floor.
 */
function jsFor(id, cfg) {
  return FEED_JS + '\n' + [
    'CK.build(' + jsLiteral(id) + ', function (sec) {',
    '  var F = window.CKFeed;',
    '  var DEF = ' + jsLiteral(cfg) + ';',
    '  var COUNTS = ' + jsLiteral(COUNTS) + ';',
    '  var MAX_FEEDS = ' + MAX_FEEDS + ';',
    '  var bodyEl = sec.querySelector(".fd-body");',
    '  var capEl = sec.querySelector(".ck-cap");',
    '',
    '  var state = { feeds: [], rows: [], failed: [], stale: [], rejected: [],',
    '                at: 0, busy: false, key: "", cached: false };',
    '',
    '  /* Selects report type "select-one", so CK.settings stores their value as a string; the',
    '     coercion also survives a hand-edited localStorage entry saying "count": "lots". */',
    '  function howMany(c) {',
    '    var n = Number(c && c.count), i;',
    '    for (i = 0; i < COUNTS.length; i++) if (COUNTS[i] === n) return n;',
    '    return DEF.count;',
    '  }',
    '',
    '  function grouping(c) { return (c && c.group === "source") ? "source" : "time"; }',
    '',
    '  /* One line per feed. Blank lines and # comments are skipped; anything that is not an',
    '     http(s) URL is collected and named in the caption rather than dropped in silence. */',
    '  function feedsOf(c) {',
    '    var raw = c && c.feeds != null ? String(c.feeds) : "";',
    '    var lines = raw.split(/[\\r\\n]+/);',
    '    var out = [], bad = [], seen = {}, i, t, u;',
    '    for (i = 0; i < lines.length; i++) {',
    '      t = F.collapse(lines[i]);',
    '      if (!t || t.charAt(0) === "#") continue;',
    '      u = F.safeHref(t);',
    '      if (!u) { bad.push(t); continue; }',
    '      if (Object.hasOwn(seen, u)) continue;',
    '      seen[u] = 1;',
    '      out.push({ url: u, label: "" });',
    '      if (out.length >= MAX_FEEDS) break;',
    '    }',
    '    return { feeds: out, rejected: bad };',
    '  }',
    '',
    '  function keyFor(url) { return "rss." + sec.dataset.card + "." + F.hash(url); }',
    '',
    '  /* Colour identifies a source, so it is assigned from the alphabetical list of sources',
    '     rather than from arrival order. Otherwise every new story would reshuffle the dots. */',
    '  function tones(rows) {',
    '    var names = [], map = {}, i, n;',
    '    for (i = 0; i < rows.length; i++) {',
    '      n = rows[i].source || "unknown";',
    '      if (!Object.hasOwn(map, n)) { map[n] = true; names.push(n); }',
    '    }',
    '    names.sort();',
    '    for (i = 0; i < names.length; i++) map[names[i]] = CK.hue(i);',
    '    return map;',
    '  }',
    '',
    '  function listHtml(rows, tone) {',
    '    var html = "", i;',
    '    for (i = 0; i < rows.length; i++) {',
    '      html += F.rowHtml(rows[i], {',
    '        showSource: true,',
    '        tone: tone[rows[i].source || "unknown"] || "",',
    '        showSummary: false',
    '      });',
    '    }',
    '    return "<ol class=\\"fd-list\\">" + html + "</ol>";',
    '  }',
    '',
    '  function bySource(rows) {',
    '    var order = [], bag = {}, i, n;',
    '    for (i = 0; i < rows.length; i++) {',
    '      n = rows[i].source || "unknown";',
    '      if (!Object.hasOwn(bag, n)) { bag[n] = []; order.push(n); }',
    '      bag[n].push(rows[i]);',
    '    }',
    '    /* rows arrive newest-first, so each bag is already sorted and bag[0] is its newest. */',
    '    order.sort(function (a, b) {',
    '      var x = bag[a][0].date ? bag[a][0].date.getTime() : 0;',
    '      var y = bag[b][0].date ? bag[b][0].date.getTime() : 0;',
    '      return y - x;',
    '    });',
    '    return { order: order, bag: bag };',
    '  }',
    '',
    '  function render(c) {',
    '    if (!bodyEl) { caption(c); return; }',
    '    var rows = F.sortDesc(state.rows);',
    '    var tone = tones(rows);',
    '    var n = howMany(c);',
    '    var html = "";',
    '    if (!rows.length) {',
    '      html = "<div class=\\"fd-empty\\">" +',
    '             (state.busy ? "fetching\\u2026" : "nothing to show yet") + "</div>";',
    '    } else if (grouping(c) === "source") {',
    '      var g = bySource(rows), i;',
    '      for (i = 0; i < g.order.length; i++) {',
    '        html += "<div class=\\"fd-group\\"><div class=\\"ck-h3\\">" +',
    '                F.esc(F.clip(g.order[i], 34)) + "</div>" +',
    '                listHtml(g.bag[g.order[i]].slice(0, n), tone) + "</div>";',
    '      }',
    '    } else {',
    '      html = listHtml(rows.slice(0, n), tone);',
    '    }',
    '    bodyEl.innerHTML = html;',
    '    caption(c);',
    '  }',
    '',
    '  function ago(ms) { var a = F.age(new Date(ms)); return a === "now" ? "just now" : a + " ago"; }',
    '',
    '  function caption(c) {',
    '    if (!capEl) return;',
    '    var n = howMany(c);',
    '    var shown = grouping(c) === "source" ? state.rows.length : Math.min(state.rows.length, n);',
    '    var live = state.feeds.length;',
    '    var line = "<b>" + F.esc(String(shown)) + "</b> " + (shown === 1 ? "item" : "items") +',
    '               " from <b>" + F.esc(String(live)) + "</b> " + (live === 1 ? "feed" : "feeds");',
    '    if (state.busy) line += " <span class=\\"ck-aside\\">fetching\\u2026</span>";',
    '    else if (state.at) line += " <span class=\\"ck-aside\\">" + F.esc(ago(state.at)) + "</span>";',
    '',
    '    if (state.cached && state.at) {',
    '      line += "<div class=\\"fd-stale\\">drawn from the last saved copy, from " +',
    '              F.esc(ago(state.at)) + "</div>";',
    '    } else if (state.stale.length) {',
    '      line += "<div class=\\"fd-stale\\">saved copies shown for " +',
    '              F.esc(state.stale.join(", ")) + "</div>";',
    '    }',
    '',
    '    /* Each failure keeps the words the server or the parser used. A 403 from the proxy',
    '       names the host and says why it is not allowed, and that sentence is the only thing',
    '       that tells the viewer what to do next. */',
    '    var i;',
    '    for (i = 0; i < state.failed.length; i++) {',
    '      line += "<div class=\\"fd-bad\\">" + F.esc(state.failed[i].label) + ": " +',
    '              F.esc(state.failed[i].error) + "</div>";',
    '    }',
    '    if (state.rejected.length) {',
    '      line += "<div class=\\"fd-bad\\">not http or https, so skipped: " +',
    '              F.esc(F.clip(state.rejected.join(", "), 160)) + "</div>";',
    '    }',
    '    if (!state.feeds.length) {',
    '      line += "<div class=\\"fd-bad\\">no feeds set \\u2014 open the gear and add one per line</div>";',
    '    }',
    '    capEl.innerHTML = line;',
    '  }',
    '',
    '  /* Every feed at once. loadAll never rejects, so one dead host costs one source and',
    '     never the whole card. */',
    '  function reload(c) {',
    '    if (state.busy || !state.feeds.length) { render(c); return; }',
    '    state.busy = true;',
    '    render(c);',
    '    F.loadAll(state.feeds).then(function (rs) {',
    '      var merged = [], failed = [], stale = [], i, r, hit;',
    '      for (i = 0; i < rs.length; i++) {',
    '        r = rs[i];',
    '        if (r.ok && r.items.length) {',
    '          F.cacheSet(keyFor(r.url), r.items);',
    '          merged = merged.concat(r.items);',
    '        } else {',
    '          failed.push({ label: r.label, error: r.error || "the feed had no items" });',
    '          hit = F.cacheGet(keyFor(r.url));',
    '          if (hit) { merged = merged.concat(hit.items); stale.push(r.label); }',
    '        }',
    '      }',
    '      state.busy = false;',
    '      state.rows = merged;',
    '      state.failed = failed;',
    '      state.stale = stale;',
    '      state.cached = false;',
    '      state.at = Date.now();',
    '      render(c);',
    '    }, function (e) {',
    '      state.busy = false;',
    '      state.failed = [{ label: "all feeds", error: F.netError(e) }];',
    '      render(c);',
    '    });',
    '  }',
    '',
    '  function apply(c) {',
    '    var got = feedsOf(c);',
    '    var urls = [], i;',
    '    for (i = 0; i < got.feeds.length; i++) urls.push(got.feeds[i].url);',
    '    var key = F.hash(urls.join(" "));',
    '    state.rejected = got.rejected;',
    '    if (key === state.key) { render(c); return; }',
    '',
    '    state.key = key;',
    '    state.feeds = got.feeds;',
    '    state.failed = []; state.stale = []; state.rows = []; state.at = 0; state.cached = false;',
    '',
    '    /* Paint whatever was saved last time before going near the network, so a swap or a',
    '       reload never shows an empty card while the fetches are in flight. */',
    '    var newest = 0, hit;',
    '    for (i = 0; i < got.feeds.length; i++) {',
    '      hit = F.cacheGet(keyFor(got.feeds[i].url));',
    '      if (!hit) continue;',
    '      state.rows = state.rows.concat(hit.items);',
    '      if (hit.at > newest) newest = hit.at;',
    '    }',
    '    if (state.rows.length) { state.cached = true; state.at = newest; }',
    '    render(c);',
    '    reload(c);',
    '  }',
    '',
    '  var conf = CK.settings(sec, DEF, apply);',
    '  F.schedule(sec, "feeds", ' + MIN_REFRESH_MS + ', function () { reload(conf.get()); });',
    '});'
  ].join('\n') + '\n';
}

/**
 * Build one instance of the rss card.
 *
 * @param id     the desk's id for this instance; becomes `data-card` and the `CK.build` key
 * @param title  the heading text
 * @param data   overrides for `meta.shape`; anything invalid quietly falls back
 * @param ord    the card's place in the desk's order, echoed onto the section
 * @returns `{ json, html, css, js }` — `json` is the settled record of what was built
 * @throws {TypeError} when `id` is not `[A-Za-z0-9_-]{1,64}`, since it lands in a script literal
 *
 * @example
 * const card = build({ id: 'river', data: { feeds: ['https://lobste.rs/rss'], group: 'source' } });
 * card.json.data.group;   // 'source'
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = safeCardId(id);
  const cfg = normalize(data);
  const heading = String(title == null || title === '' ? 'Feeds' : title);
  const order = Number.isFinite(Number(ord)) ? Number(ord) : 0;

  return {
    json: { id: cardId, type: meta.name, title: heading, ord: order, data: cfg },
    html: htmlFor(cardId, heading, order),
    css: cssFor(),
    js: jsFor(cardId, cfg)
  };
}
