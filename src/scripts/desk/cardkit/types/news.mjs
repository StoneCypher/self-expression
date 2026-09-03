/* cardkit / news — one feed, read the way a front page is read.
 *
 * Headline first, then a thin line of source and age. No thumbnails, no excerpt unless asked
 * for: the job of this card is to let a glance answer 'anything happened?', and every pixel
 * spent on decoration is a headline that did not fit.
 *
 * The sibling `rss` card merges many feeds; if you want more than one source at a time, that is
 * the card. Everything both of them know about feeds lives in `_feed.mjs`.
 */

import {
  FEED_JS, MIN_REFRESH_MS, escHtml, feedCss, jsLiteral, safeCardId
} from './_feed.mjs';

/**
 * The feeds offered by name in the settings panel.
 *
 * Every host here is already on the desk server's allowlist, because a preset that returns 403
 * is worse than no preset — it looks like the card is broken rather than like the desk is
 * refusing. Adding one means adding its host to the server first; `CK.net` is not something a
 * card can talk its way around, and it should not try.
 *
 * @example PRESETS[0].url;   // 'https://hnrss.org/frontpage'
 */
export const PRESETS = [
  { name: 'Hacker News',       url: 'https://hnrss.org/frontpage' },
  { name: 'Hacker News — best', url: 'https://hnrss.org/best' },
  { name: 'Lobsters',          url: 'https://lobste.rs/rss' },
  { name: 'BBC News',          url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'BBC Technology',    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { name: 'Ars Technica',      url: 'https://arstechnica.com/feed/' },
  { name: 'Slashdot',          url: 'https://rss.slashdot.org/Slashdot/slashdotMain' },
  { name: 'The Register',      url: 'https://www.theregister.com/headlines.atom' }
];

/** How many headlines a viewer may ask for. A select, not a number box: three answers is enough. */
const COUNTS = [5, 10, 20];

/** What the card does before anyone touches the gear. */
const DEFAULTS = { feed: PRESETS[0].url, count: 10, summaries: false };

/**
 * What this card type is, for the desk's type picker.
 *
 * `shape` is the one-line data literal a caller would write; `defaults` is the machine-readable
 * half, every setting with its fallback. This card's data and its settings are deliberately the
 * same three keys, so a card configured in a file and a card configured through the gear are the
 * same card — but they are still two fields, because a validator checks the panel against
 * `defaults` and a human reads `shape`.
 */
export const meta = {
  name: 'news',
  summary: 'One feed, headline-first: title, source and how long ago.',
  shape: '{ feed, count, summaries } — feed an http(s) RSS or Atom URL on the desk allowlist, count 5 | 10 | 20, summaries a boolean',
  category: 'live-and-ambient',
  defaults: { ...DEFAULTS }
};

/**
 * Settle whatever the desk's config file said into a config the card can actually run.
 *
 * Invalid values fall back rather than throwing: a typo in a hand-edited desk file should cost
 * the viewer a wrong setting, not a missing card.
 *
 * @param data  the raw `data` block for this card instance; may be undefined
 *
 * @example normalize({ count: 99 });   // { feed: 'https://hnrss.org/frontpage', count: 10, summaries: false }
 */
function normalize(data) {
  const d = data && typeof data === 'object' ? data : {};
  const feed = typeof d.feed === 'string' && /^https?:\/\/\S+$/i.test(d.feed.trim())
    ? d.feed.trim() : DEFAULTS.feed;
  const count = COUNTS.indexOf(Number(d.count)) >= 0 ? Number(d.count) : DEFAULTS.count;
  return { feed, count, summaries: d.summaries === true };
}

/**
 * The card's markup: heading, gear, settings, the list, the caption.
 *
 * The gear is emitted with no content at all — not even whitespace. `CK.settings` fills it only
 * when `gear.firstChild` is null, and a newline between the tags is a text node.
 */
function htmlFor(id, title, ord, cfg) {
  const opts = PRESETS
    .map((p) => '<option value="' + escHtml(p.url) + '">' + escHtml(p.name) + '</option>')
    .join('');
  const counts = COUNTS
    .map((n) => '<option value="' + n + '">' + n + '</option>')
    .join('');

  return [
    '<section data-card="' + escHtml(id) + '" class="ck-news" data-ord="' + escHtml(String(ord)) + '">',
    '<h2>' + escHtml(title) + '</h2>',
    '<button class="ck-gear" title="settings" aria-label="settings"></button>',
    '<div class="ck-set" hidden>',
      '<label for="' + escHtml(id) + '-feed">feed</label>',
      '<select id="' + escHtml(id) + '-feed" name="feed">' + opts +
        '<option value="">— custom, below —</option></select>',
      '<label for="' + escHtml(id) + '-url">URL</label>',
      '<input id="' + escHtml(id) + '-url" name="feed" type="url" inputmode="url" spellcheck="false"' +
        ' placeholder="https://…" autocomplete="off">',
      '<label for="' + escHtml(id) + '-count">show</label>',
      '<select id="' + escHtml(id) + '-count" name="count">' + counts + '</select>',
      '<label for="' + escHtml(id) + '-sum">summaries</label>',
      '<input id="' + escHtml(id) + '-sum" name="summaries" type="checkbox">',
      '<div class="ck-set-foot">Refreshes every five minutes. The host must be on the desk' +
        ' server’s allowlist; anything else comes back refused, with the reason.</div>',
    '</div>',
    '<ol class="fd-list" aria-live="polite"></ol>',
    '<div class="ck-cap">waiting for the first fetch…</div>',
    '</section>'
  ].join('');
}

/**
 * The card's CSS: the shared feed rules plus the two things only this card has.
 *
 * Nothing here names a colour. Every value is a `--` token, so the card is correct in both
 * themes for the same reason the rest of the desk is: it never states one.
 */
function cssFor() {
  return [
    feedCss('.ck-news'),
    '.ck-news .fd-list { counter-reset: none; }',
    /* Headline-first means the headline is the biggest thing in the row and the only thing
       with full ink; the meta line is deliberately quiet enough to skip. */
    '.ck-news .fd-t { font-size: 13.5px; }',
    '.ck-news .fd-row:first-child .fd-t { font-size: 14.5px; }'
  ].join('\n');
}

/**
 * The card's browser script.
 *
 * Classic-script style throughout, and concatenated after `FEED_JS` so `window.CKFeed` exists
 * by the time `CK.build` runs the body.
 *
 * The one non-obvious rule in here: a settings change only re-fetches when it changed WHICH
 * feed is being read. Changing the count or toggling summaries re-renders rows the card is
 * already holding. Refetching on a cosmetic toggle would be a way to beat the five-minute floor
 * without meaning to.
 */
function jsFor(id, cfg) {
  const index = {};
  for (const p of PRESETS) index[p.url] = p.name;

  return FEED_JS + '\n' + [
    'CK.build(' + jsLiteral(id) + ', function (sec) {',
    '  var F = window.CKFeed;',
    '  var DEF = ' + jsLiteral(cfg) + ';',
    '  var NAMES = ' + jsLiteral(index) + ';',
    '  var COUNTS = ' + jsLiteral(COUNTS) + ';',
    '  var listEl = sec.querySelector(".fd-list");',
    '  var capEl = sec.querySelector(".ck-cap");',
    '',
    '  var state = { items: [], at: 0, cached: false, busy: false, key: "", url: "", why: "",',
    '                error: null, label: "" };',
    '',
    '  /* A <select> reports type "select-one", so CK.settings leaves its value a string.',
    '     Coercing here rather than trusting the stored value also survives a hand-edited',
    '     localStorage entry saying "count": "many". */',
    '  function howMany(c) {',
    '    var n = Number(c && c.count);',
    '    for (var i = 0; i < COUNTS.length; i++) if (COUNTS[i] === n) return n;',
    '    return DEF.count;',
    '  }',
    '',
    '  /* Both the preset picker and the free-text box are name="feed", so whichever the viewer',
    '     touched last is the feed. The empty preset option means "use the box"; when the box is',
    '     empty too we fall back to the configured default rather than showing nothing. */',
    '  function choose(c) {',
    '    var raw = c && c.feed != null ? String(c.feed) : "";',
    '    if (!F.collapse(raw)) return { url: F.safeHref(DEF.feed), why: "" };',
    '    var ok = F.safeHref(raw);',
    '    if (ok) return { url: ok, why: "" };',
    '    return { url: "", why: "that is not an http or https address, so nothing was fetched" };',
    '  }',
    '',
    '  function render(c) {',
    '    var rows = F.sortDesc(state.items).slice(0, howMany(c));',
    '    var html = "", i;',
    '    for (i = 0; i < rows.length; i++) {',
    '      html += F.rowHtml(rows[i], { showSummary: !!(c && c.summaries), showSource: true });',
    '    }',
    '    if (!html) {',
    '      html = "<li class=\\"fd-empty\\">" +',
    '             (state.busy ? "fetching\\u2026" : state.error ? "nothing to show" : "no items yet") +',
    '             "</li>";',
    '    }',
    '    if (listEl) listEl.innerHTML = html;',
    '    caption(c);',
    '  }',
    '',
    '  function ago(ms) { var a = F.age(new Date(ms)); return a === "now" ? "just now" : a + " ago"; }',
    '',
    '  function caption(c) {',
    '    if (!capEl) return;',
    '    var shown = Math.min(state.items.length, howMany(c));',
    '    var name = state.label ||',
    '               (state.items.length ? state.items[0].source : "") ||',
    '               F.hostOf(state.url) || "no feed";',
    '    var line = "<b>" + F.esc(String(shown)) + "</b> " +',
    '               (shown === 1 ? "headline" : "headlines") + " from <i>" + F.esc(name) + "</i>";',
    '    if (state.busy) line += " <span class=\\"ck-aside\\">fetching\\u2026</span>";',
    '    else if (state.at) line += " <span class=\\"ck-aside\\">" + F.esc(ago(state.at)) + "</span>";',
    '    if (state.cached && state.at) {',
    '      line += "<div class=\\"fd-stale\\">showing the last saved copy, from " +',
    '              F.esc(ago(state.at)) + "</div>";',
    '    }',
    '    /* The proxy explains a refusal in its own words; those words are the useful ones. */',
    '    if (state.error) line += "<div class=\\"fd-bad\\">" + F.esc(state.error) + "</div>";',
    '    capEl.innerHTML = line;',
    '  }',
    '',
    '  function reload(c) {',
    '    if (state.busy) return;',
    '    if (!state.url) {',
    '      state.error = state.why || "no feed is set \\u2014 open the gear and choose one";',
    '      render(c);',
    '      return;',
    '    }',
    '    state.busy = true;',
    '    render(c);',
    '    F.loadAll([{ url: state.url, label: state.label }]).then(function (rs) {',
    '      var r = rs[0];',
    '      state.busy = false;',
    '      if (r.ok && r.items.length) {',
    '        state.items = r.items;',
    '        state.at = Date.now();',
    '        state.cached = false;',
    '        state.error = null;',
    '        F.cacheSet(state.key, r.items);',
    '      } else {',
    '        state.error = r.error || "the feed parsed but had no items";',
    '      }',
    '      render(c);',
    '    }, function (e) {',
    '      state.busy = false;',
    '      state.error = F.netError(e);',
    '      render(c);',
    '    });',
    '  }',
    '',
    '  function apply(c) {',
    '    var pickd = choose(c);',
    '    var key = "news." + sec.dataset.card + "." + F.hash(pickd.url);',
    '    if (key === state.key) { render(c); return; }',
    '    state.key = key;',
    '    state.url = pickd.url;',
    '    state.why = pickd.why;',
    '    state.label = Object.hasOwn(NAMES, pickd.url) ? NAMES[pickd.url] : "";',
    '    state.items = []; state.at = 0; state.cached = false; state.error = null;',
    '    /* Draw the cached copy first so a swap or a reload is never a blank card, then go and',
    '       find out whether it is still true. */',
    '    var hit = F.cacheGet(key);',
    '    if (hit) { state.items = hit.items; state.at = hit.at; state.cached = true; }',
    '    render(c);',
    '    reload(c);',
    '  }',
    '',
    '  var conf = CK.settings(sec, DEF, apply);',
    '  F.schedule(sec, "feed", ' + MIN_REFRESH_MS + ', function () { reload(conf.get()); });',
    '});'
  ].join('\n') + '\n';
}

/**
 * Build one instance of the news card.
 *
 * @param id     the desk's id for this instance; becomes `data-card` and the `CK.build` key
 * @param title  the heading text
 * @param data   overrides for `meta.shape`; anything invalid quietly falls back
 * @param ord    the card's place in the desk's order, echoed onto the section
 * @returns `{ json, html, css, js }` — `json` is the settled record of what was built
 * @throws {TypeError} when `id` is not `[A-Za-z0-9_-]{1,64}`, since it lands in a script literal
 *
 * @example
 * const card = build({ id: 'news', title: 'Front page', data: { count: 20 }, ord: 3 });
 * card.json.data.count;   // 20
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = safeCardId(id);
  const cfg = normalize(data);
  const heading = String(title == null || title === '' ? 'News' : title);
  const order = Number.isFinite(Number(ord)) ? Number(ord) : 0;

  return {
    json: { id: cardId, type: meta.name, title: heading, ord: order, data: cfg },
    html: htmlFor(cardId, heading, order, cfg),
    css: cssFor(),
    js: jsFor(cardId, cfg)
  };
}
