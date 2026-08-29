/**
 * `image` -- a local image, or a small gallery of them, that says what it could not show.
 *
 * The whole design of this type follows from one line of the desk's policy: the CSP is
 * `default-src 'self'`. A remote image does not load slowly or load badly on this page; it does
 * not load at all, and the browser reports nothing the card can see. So a card that took any
 * URL and put it in a `src` would render a column of broken frames and no explanation, and the
 * reader would conclude the desk was broken rather than that the source was refused. Refusing
 * the source in Node, drawing a legible tile in its place, and naming the reason in the caption
 * is not extra politeness -- it is the difference between a card that failed and a card that
 * told you what happened.
 *
 * The same reasoning drives the two other refusals here. A missing `alt` is surfaced rather than
 * papered over, because an image with no alternative text is a hole in the page for anyone using
 * a screen reader and nobody ever fixes a defect they were not shown. An oversized `data:` URI
 * is capped, because a data URI is inlined into `card.html` and the desk assembles every card's
 * markup into one document -- four megabytes of base64 in one card is four megabytes on every
 * load of the whole desk.
 *
 * @see ./matrix.mjs -- the same emit shape, the same vm-loaded kit
 * @see ./map.mjs -- written alongside this one, same guard
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/**
 * The shared card runtime, available to Node.
 *
 * `kit.js` assigns `window.CK` as a classic script; it is not a module and cannot be imported.
 * Its top level defines only functions and one array, so a bare context carrying a `window`
 * object is enough -- nothing reaches for `document` until a DOM function is called, and none
 * of those are called here.
 *
 * @returns the same `CK` object the page gets
 * @throws {Error} when `kit.js` is missing, unreadable, or stops defining `window.CK`
 *
 * @example loadKit().esc('<b>');   // '&lt;b&gt;'
 */
function loadKit() {
  const where = new URL('../kit.js', import.meta.url);
  let src;
  try { src = readFileSync(where, 'utf8'); }
  catch (e) { throw new Error('cardkit/image: cannot read ' + where.pathname + ' -- ' + e.message); }
  const sandbox = { window: {} };
  runInNewContext(src, sandbox, { filename: 'kit.js' });
  if (!sandbox.window.CK) throw new Error('cardkit/image: kit.js no longer defines window.CK');
  return sandbox.window.CK;
}

const CK = loadKit();

/* ── constants ────────────────────────────────────────────────────────────────────────── */

/** The two things `fit` may say, and the four things `columns` may say. */
const FITS = ['contain', 'cover'];
const COLUMNS = [1, 2, 3, 4];

/**
 * Media types allowed inside a `data:` URI.
 *
 * `image/svg+xml` is on the list and it is the one worth defending. An SVG referenced by an
 * `<img>` element is loaded in a restricted mode in every current browser: its scripts do not
 * run, its external references do not resolve, and it cannot reach the document that embedded
 * it. That is a property of `<img>`, not of the file, which is why the same SVG must never be
 * dropped into the page with `innerHTML` -- and nothing here ever does.
 */
const DATA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp',
                    'image/avif', 'image/svg+xml'];

/**
 * How much inline image data one card may carry, in characters of URI text.
 *
 * A data URI is not fetched, it is *stored*, in `card.html`, which the desk reads and
 * concatenates with every other card on every load. A single 4 MB photograph pasted in as
 * base64 is therefore a 4 MB tax on the whole desk, paid before anything renders, and it is
 * invisible in the source because it is one very long line. The per-image cap is roughly a
 * 380 KB picture; the card cap is a little over four of those.
 */
const DATA_CAP = 512 * 1024;
const DATA_CAP_TOTAL = 2 * 1024 * 1024;

/** How many images one card will lay out before it stops and says why. */
const MAX_IMAGES = 60;

/**
 * Every setting this card understands, with the value that stands when nothing else does.
 *
 * Exported so a panel's field names can be checked against it in both directions rather than
 * trusted: a `name` in the markup that is not a key here is a control that silently does
 * nothing, and `CK.settings` -- correctly -- ignores it without complaining.
 *
 * A card *instance* narrows these: `data.columns` and `data.fit` become the fallbacks actually
 * handed to `CK.settings`, so a gallery authored three across opens three across. The key set
 * is identical either way, which is the part a validator cares about.
 *
 * @example defaults.fit;   // 'contain'
 */
export const defaults = { columns: 2, fit: 'contain', captions: true };

/**
 * What this type is and what it eats, for a deck index or a picker.
 *
 * `shape` is a string on purpose: it is read by a person deciding what to feed the card, and it
 * has to read at a glance.
 *
 * @example meta.name;   // 'image'
 */
export const meta = {
  name: 'image',
  summary:
    'A local image or a small gallery, click to enlarge in place, refusing every source the ' +
    'desk cannot actually load and saying so instead of showing a broken frame.',
  shape:
    '{ images: [{ src, alt, caption }], fit, columns } -- ' +
    'src is a same-origin path or a data: URI and nothing else, because the CSP is ' +
    "default-src 'self' and a remote image fails with no error the card can see; " +
    'alt is required per image and a missing one is reported rather than hidden; ' +
    'fit is contain or cover and columns is 1 to 4, both of which are also viewer settings',
  defaults: { ...defaults },
};

/* ── small shared arithmetic ──────────────────────────────────────────────────────────── */

/**
 * Serialise a value as a JavaScript literal that is safe inside a `<script>` element.
 *
 * `<` becomes an escape so a caption containing `</script>` cannot close the block early; `>`
 * goes with it, which has the useful side effect that no caption can put an arrow function's
 * two characters into a file that is contractually free of them. Backticks go too, for the same
 * contract, and the two line separators because they are newlines to a JavaScript parser and
 * not to `JSON.stringify`.
 *
 * The question mark is here for one reason and it was found by testing rather than by thinking:
 * {@link guardEmitted} scans the RAW emitted text for `?.`, on the correct grounds that optional
 * chaining cannot appear innocently in classic-script code -- but a *caption* containing the two
 * characters lands inside a string literal and trips it, and a build that refuses a card because
 * a caption said "really?." would be a guard nobody keeps. Escaping the character makes the scan
 * true again instead of loosening it, which is the same trade `>` already makes. Every one of
 * these decodes back to itself, so no rendered text changes.
 *
 * @example jsonLit({ cap: '</script>' });   // '{"cap":"\\u003c/script\\u003e"}'
 */
function jsonLit(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\?/g, '\\u003f')
    .replace(/`/g, '\\u0060')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A string taken from data, with every control character turned into a space.
 *
 * `CK.esc` handles the characters that mean something to an HTML parser. It does not touch the
 * ones that mean nothing to anybody: a NUL, a bell or an escape inside a caption passes straight
 * through it, lands in `card.html`, and is then invisible in the file, rendered as a space by
 * every tool that reads it back, and legal to every parser that sees it. That is the exact
 * failure the contract spends a page on, arriving through the one door escaping does not cover
 * -- and it was found here by a test feeding an image an alt with a NUL in it.
 *
 * Tab, newline and carriage return are replaced too rather than kept. They are legal, but a
 * caption is a phrase, HTML collapses them to a space anyway, and keeping them would mean a
 * caption whose text differs from its markup for no reader-visible gain.
 *
 * The comparison is numeric on purpose. Writing a character class for this is how the character
 * class ends up holding the character it was meant to describe; `charCodeAt` cannot be mistyped
 * and cannot be decoded early, because it does not contain the character at all.
 *
 * @param s anything; `null` and `undefined` become the empty string
 * @returns the same text, with control characters replaced and the ends trimmed
 *
 * @example clean('a' + String.fromCharCode(0) + 'b');   // 'a b'
 */
function clean(s) {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out += (c < 32 || c === 127) ? ' ' : str[i];
  }
  return out.trim();
}

/**
 * Whether a string holds a character no URL may contain.
 *
 * A source is not cleaned the way a caption is, because a path with a control character in it is
 * not a path with a typo -- it is a path that does not mean what it looks like, and replacing the
 * character would produce a *different* path and then fetch it. Refusing is the only answer that
 * cannot silently load the wrong file.
 *
 * @example hasControl('/a' + String.fromCharCode(9) + 'b.png');   // true
 */
function hasControl(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/** `count` of a thing, pluralised the only way English lets you do it safely. */
function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

/** A byte count a person can read. */
function bytes(k) {
  if (k >= 1024 * 1024) return (Math.round(k / (1024 * 1024) * 10) / 10) + ' MB';
  if (k >= 1024) return Math.round(k / 1024) + ' KB';
  return k + ' bytes';
}

/* ── the scheme allowlist ─────────────────────────────────────────────────────────────── */

/**
 * Decide whether a source is one this page can actually load, by parsing it rather than
 * matching against a list of things known to be bad.
 *
 * **The allowlist is exactly two things.** A same-origin path, and a `data:` URI of an image
 * media type. Everything else is refused, `https:` included, and that last part is the one that
 * surprises people, so here is the mechanism it protects against.
 *
 * The desk's CSP is `default-src 'self'`. A remote `<img>` is not slow and is not blocked with
 * an error the card can catch -- the request never leaves the browser, an `error` event fires
 * with no detail, and the frame stays empty. A card that allowed remote URLs would therefore
 * render a grid of blank boxes and have nothing true to say about any of them. Refusing here,
 * in Node, is what makes the caption able to say *which* source and *why*.
 *
 * Blacklisting is the wrong shape for this and would be wrong even if the CSP were laxer.
 * `javascript:`, `vbscript:` and `data:text/html` all have to be excluded, and the moment the
 * rule is "reject the bad ones" the card is one new scheme away from being wrong. Parsing the
 * scheme and comparing it to two accepted answers cannot fail that way.
 *
 * Three more refusals are worth naming because each of them is a real path that looks local:
 *
 *   - `//example.com/a.png` is protocol-relative. It has no scheme in its text and it is a
 *     remote URL. Checked explicitly, because the scheme test alone would pass it.
 *   - a path containing `..` can climb out of whatever directory the desk means to serve.
 *   - a backslash is a path separator on the platform this desk runs on and is not one to a
 *     URL parser, so the two disagree about what the path means. Refused rather than resolved.
 *
 * @param raw whatever arrived as `src`
 * @returns `{ ok }` and, when refused, `why` -- a sentence the caption prints verbatim
 *
 * @example classifySrc('/shots/a.png');        // { ok: true, kind: 'path', shown: '/shots/a.png' }
 * @example classifySrc('https://x.test/a.png').why;
 * // 'the https: scheme is not allowed here; the desk serves only its own files'
 */
function classifySrc(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, why: 'no source was given' };
  }
  const src = raw.trim();
  if (hasControl(src)) {
    return { ok: false, why: 'that source holds a control character, so it is not a path at all' };
  }

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(src);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== 'data') {
      return {
        ok: false,
        why: 'the ' + name + ': scheme is not allowed here; the desk serves only its own files',
      };
    }

    const comma = src.indexOf(',');
    if (comma < 0) return { ok: false, why: 'that data: URI has no comma, so it carries no data' };

    const head = src.slice(5, comma).split(';');
    const type = head[0].toLowerCase().trim();
    if (DATA_TYPES.indexOf(type) < 0) {
      return {
        ok: false,
        why: 'a data: URI of type ' + (type || 'nothing at all') +
             ' is not an image this card will render',
      };
    }
    if (src.length > DATA_CAP) {
      return {
        ok: false,
        why: 'that data: URI is ' + bytes(src.length) + ', over the ' + bytes(DATA_CAP) +
             ' cap for one inline image',
      };
    }
    return { ok: true, kind: 'data', shown: 'an inline ' + type + ', ' + bytes(src.length), src };
  }

  if (src.slice(0, 2) === '//') {
    return { ok: false, why: 'that is a protocol-relative URL, which is a remote one' };
  }
  if (src.indexOf('\\') >= 0) {
    return { ok: false, why: 'a backslash is not a path separator in a URL' };
  }
  if (/(^|\/)\.\.(\/|$)/.test(src)) {
    return { ok: false, why: 'a path containing .. can climb out of what the desk serves' };
  }
  return { ok: true, kind: 'path', shown: src, src };
}

/* ── reading the data ─────────────────────────────────────────────────────────────────── */

/**
 * Normalise the whole `data` block into the one shape the rest of the file may assume.
 *
 * Nothing here throws on bad input. Every refusal is counted and carried through to the caption,
 * because a gallery of twelve images where one source is remote should show eleven pictures and
 * one honest tile, not an exception.
 *
 * The running total of inline data is enforced across images rather than per image, so twenty
 * URIs of 400 KB each -- each one legal on its own -- cannot add up to eight megabytes in one
 * card. Images past the total are refused in the order they were written, which is arbitrary but
 * predictable, and the caption says how many.
 *
 * @param data the card's `data` block, possibly malformed or absent
 * @returns `{ items, counts, cols, fit, over }`
 *
 * @example readData({ images: [{ src: '/a.png', alt: 'a' }] }).items[0].ok;   // true
 */
function readData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const raw = Array.isArray(d.images) ? d.images
    : (d.images && typeof d.images === 'object' ? [d.images] : []);

  const counts = { refused: 0, noAlt: 0, remote: 0, overCap: 0, noSrc: 0 };
  const items = [];
  let inline = 0;
  const over = Math.max(0, raw.length - MAX_IMAGES);

  raw.slice(0, MAX_IMAGES).forEach((entry, i) => {
    const o = entry && typeof entry === 'object' ? entry : { src: entry };
    const got = classifySrc(o.src);

    const alt = clean(o.alt);
    if (!alt) counts.noAlt++;

    const caption = clean(o.caption);

    if (got.ok && got.kind === 'data') {
      if (inline + got.src.length > DATA_CAP_TOTAL) {
        counts.refused++;
        counts.overCap++;
        items.push({
          ok: false, alt, caption, index: i + 1,
          why: 'this card had already reached its ' + bytes(DATA_CAP_TOTAL) +
               ' of inline image data',
        });
        return;
      }
      inline += got.src.length;
    }

    if (!got.ok) {
      counts.refused++;
      if (/scheme is not allowed|protocol-relative/.test(got.why)) counts.remote++;
      if (/cap for one inline image/.test(got.why)) counts.overCap++;
      if (got.why === 'no source was given') counts.noSrc++;
      items.push({ ok: false, alt, caption, index: i + 1, why: got.why });
      return;
    }

    items.push({ ok: true, alt, caption, index: i + 1, src: got.src, shown: got.shown, kind: got.kind });
  });

  const cols = COLUMNS.indexOf(Number(d.columns)) >= 0 ? Number(d.columns) : defaults.columns;
  const fit = FITS.indexOf(d.fit) >= 0 ? d.fit : defaults.fit;

  return { items, counts, cols, fit, over, inline, asked: raw.length };
}

/* ── emit ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The card's id as it may appear inside a double-quoted CSS attribute selector.
 *
 * The id becomes a directory name and is not viewer-supplied, but it is still a string this
 * file did not write, and a quote in it would end the selector early and leave the rest of the
 * stylesheet as garbage the browser skips in silence.
 *
 * @example cssId('a"b');   // 'a\\"b'
 */
function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }

/** Prefix every selector in a rule list with the card's own scope. One card, one blast radius. */
function scope(id, rules) {
  const own = '.ck-image[data-card="' + cssId(id) + '"]';
  return rules
    .map(([sel, body]) => {
      const heads = (sel ? sel.split(',') : ['']).map((s) => (s.trim() ? own + ' ' + s.trim() : own));
      return heads.join(',\n') + ' { ' + body + ' }';
    })
    .join('\n');
}

/**
 * The card's stylesheet.
 *
 * Nothing here names a colour. Every value is a desk token, so the light switch is the only
 * thing that has to know anything and the card is correct in a theme it was never opened in.
 * `prefers-color-scheme` is deliberately absent: the desk is one document open in two viewers
 * that want different answers, and the OS gives both the same answer.
 *
 * The rule doing the most work is the `aspect-ratio` on the frame. An `<img>` with no width or
 * height attribute has no size until its bytes arrive, so a grid of them is zero pixels tall
 * and then suddenly is not -- the card jumps, and everything below it on the desk jumps with
 * it. Reserving a box up front costs nothing and removes the jump entirely, which is why the
 * frame is a box that holds an image rather than an image that happens to have a size.
 *
 * Enlarging is a grid change, not an overlay. `grid-column: 1 / -1` makes the cell span every
 * column, the rest of the gallery reflows around it, and the page keeps scrolling normally --
 * where a modal would trap focus, hide the rest of the desk and need its own dismissal.
 */
function cardCss(id) {
  const own = '.ck-image[data-card="' + cssId(id) + '"]';
  const rules = [
    ['', 'position: relative;'],
    ['h2', 'font: 600 13px/1.35 var(--disp), var(--ui); color: var(--ink); margin: 0 0 10px;'],

    ['.ck-img-grid', 'display: grid; gap: 8px; margin-top: 2px; align-items: start;'],
    ['.ck-img-fig', 'margin: 0; min-width: 0;'],
    ['.ck-img-fig[data-big="1"]', 'grid-column: 1 / -1;'],

    ['.ck-img-tile',
     'display: block; width: 100%; padding: 0; border: 1px solid var(--hairline); ' +
     'border-radius: 6px; background: var(--well); cursor: zoom-in; overflow: hidden; font: inherit;'],
    ['.ck-img-tile:hover', 'border-color: var(--pill-edge);'],
    ['.ck-img-tile:focus-visible', 'outline: 2px solid var(--accent); outline-offset: 2px;'],
    ['.ck-img-fig[data-big="1"] .ck-img-tile', 'cursor: zoom-out; border-color: var(--accent);'],

    /* The reserved box. Nothing below this card moves when the bytes arrive. */
    ['.ck-img-frame', 'display: block; width: 100%; aspect-ratio: 4 / 3; overflow: hidden;'],
    ['.ck-img-fig[data-big="1"] .ck-img-frame', 'aspect-ratio: 16 / 9; max-height: 62vh;'],
    ['.ck-img-frame img', 'display: block; width: 100%; height: 100%; object-fit: contain;'],
    ['.ck-img-grid[data-fit="cover"] .ck-img-frame img', 'object-fit: cover;'],

    /* A source the card refused, or one the browser could not fetch. Same tile either way, so
       a reader learns one shape rather than two. */
    ['.ck-img-bad',
     'display: flex; flex-direction: column; justify-content: center; gap: 4px; ' +
     'width: 100%; height: 100%; padding: 10px 12px; box-sizing: border-box; ' +
     'font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint); ' +
     'background: var(--well); text-align: left;'],
    ['.ck-img-bad b', 'color: var(--ink-dim); font-weight: 400; font-family: var(--ui);'],
    ['.ck-img-bad span', 'overflow-wrap: anywhere;'],

    ['.ck-img-cap',
     'font-size: 11px; line-height: 1.45; color: var(--ink-dim); margin-top: 5px; ' +
     'overflow-wrap: anywhere;'],
    ['.ck-img-cap .ck-img-flag', 'color: var(--accent);'],
    ['.ck-img-cap .ck-img-why', 'color: var(--ink-faint);'],
    ['.ck-img-grid[data-caps="0"] .ck-img-cap', 'display: none;'],

    ['.ck-img-void', 'color: var(--ink-faint); font-size: 12px; padding: 12px 0 4px;'],

    /* A checkbox inherits the panel's full-width input rule and comes out as a stretched
       lozenge; it wants to be its own size, at the start of its column. */
    ['.ck-set input[type="checkbox"]', 'width: auto; justify-self: start;'],
  ];

  return scope(id, rules) + '\n' +
    ':root[data-theme="light"] ' + own + ' .ck-img-tile { border-color: var(--rule); }\n';
}

/**
 * One tile's markup.
 *
 * A refused source gets a `<div>` and no button: there is nothing to enlarge, and a control
 * that focuses and does nothing is worse than no control. An accepted one gets a button
 * wrapping the frame, which is what makes the gallery keyboard-reachable without a single
 * `tabindex` -- a button is focusable, Enter and Space activate it, and the whole thing is one
 * element the browser already knows how to announce.
 *
 * The `alt` of an image with no alternative text is not left empty. An empty `alt` is a
 * *claim* -- it tells a screen reader the image is decorative and may be skipped -- and this
 * card cannot know that. Saying what is actually true is both more honest and the only version
 * that gets the defect fixed.
 */
function tileHtml(item, total) {
  const e = CK.esc;
  const nth = 'image ' + item.index + ' of ' + total;

  const cap = [];
  if (item.caption) cap.push(e(item.caption));
  if (!item.ok) cap.push('<span class="ck-img-why">not shown: ' + e(item.why) + '</span>');
  if (!item.alt) cap.push('<span class="ck-img-flag">no alt text was given for this image</span>');
  const caption = cap.length
    ? '    <figcaption class="ck-img-cap">' + cap.join(' <span class="ck-aside">&middot;</span> ') +
      '</figcaption>\n'
    : '';

  if (!item.ok) {
    return '  <figure class="ck-img-fig" data-big="0">\n' +
      '    <div class="ck-img-frame">\n' +
      '      <div class="ck-img-bad" role="img" aria-label="' +
      e(nth + ' was not shown: ' + item.why) + '">' +
      '<b>this source is not allowed here</b><span>' + e(item.why) + '</span></div>\n' +
      '    </div>\n' +
      caption +
      '  </figure>\n';
  }

  const alt = item.alt || (nth + ', with no alternative text supplied');
  return '  <figure class="ck-img-fig" data-big="0">\n' +
    '    <button type="button" class="ck-img-tile" aria-expanded="false" aria-label="' +
    e('enlarge ' + nth + ': ' + alt) + '">\n' +
    '      <span class="ck-img-frame"><img src="' + e(item.src) + '" alt="' + e(alt) +
    '" data-src="' + e(item.shown) + '" loading="lazy" decoding="async"></span>\n' +
    '    </button>\n' +
    caption +
    '  </figure>\n';
}

/**
 * The card's markup: one section, a gear, a settings panel, the gallery and the caption.
 *
 * Every interpolated value goes through `CK.esc`. The grid's column count and fit are set by the
 * script from the viewer's settings rather than written here, because both are settings; what is
 * written here is everything that cannot change, so the card is legible with the script removed.
 */
function cardHtml(id, title, R) {
  const e = CK.esc;
  const shown = R.items.filter((i) => i.ok).length;
  const total = R.items.length;

  const junk = [];
  if (R.counts.remote) junk.push(plural(R.counts.remote, 'source was', 'sources were') +
    ' remote, which this page cannot load at all');
  if (R.counts.overCap) junk.push(plural(R.counts.overCap, 'inline image was', 'inline images were') +
    ' over the size cap');
  if (R.counts.noSrc) junk.push(plural(R.counts.noSrc, 'entry had', 'entries had') + ' no source');
  if (R.counts.noAlt) junk.push(plural(R.counts.noAlt, 'image has', 'images have') +
    ' no alt text, which is a defect in the data and is flagged on the tile');
  if (R.over) junk.push(plural(R.over, 'image', 'images') + ' past the first ' + MAX_IMAGES +
    ' were not laid out');
  if (R.inline) junk.push(bytes(R.inline) + ' of that is inline data carried in this card');

  const body = !total
    ? '  <div class="ck-img-void">no images &mdash; this card was given an empty gallery</div>\n'
    : '  <div class="ck-img-grid" data-fit="' + e(R.fit) + '" data-caps="1">\n' +
      R.items.map((item) => tileHtml(item, total)).join('') +
      '  </div>\n';

  const census = !total ? 'nothing to show'
    : shown === total
      ? '<b>' + shown + '</b> ' + (shown === 1 ? 'image' : 'images')
      : '<b>' + shown + '</b> of ' + total + ' shown';

  return '<section data-card="' + e(id) + '" class="ck-image">\n' +
    '  <h2>' + e(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + e(id) + '-columns">columns</label>\n' +
    '    <select id="' + e(id) + '-columns" name="columns">\n' +
    COLUMNS.map((c) => '      <option value="' + c + '">' + c + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-fit">fit</label>\n' +
    '    <select id="' + e(id) + '-fit" name="fit">\n' +
    FITS.map((f) => '      <option value="' + f + '">' + f + '</option>\n').join('') +
    '    </select>\n' +
    '    <label for="' + e(id) + '-captions">captions</label>\n' +
    '    <input type="checkbox" id="' + e(id) + '-captions" name="captions">\n' +
    '    <div class="ck-set-foot">' +
    (total === 1
      ? 'a single image always spans the row, so columns does nothing here. '
      : '') +
    'click a tile to enlarge it in place; escape puts it back.' +
    '</div>\n' +
    '  </div>\n' +
    body +
    '  <div class="ck-cap">' + census +
    (total ? ', ' + e(R.fit) + ' in ' + plural(R.cols, 'column', 'columns') + ' by default' : '') +
    '. <i class="ck-img-note"></i>' +
    (junk.length ? ' <span class="ck-aside">' + e(junk.join('; ')) + '.</span>' : '') +
    '</div>\n' +
    '</section>\n';
}

/**
 * The browser half: apply the three settings, wire the gallery, and handle images that fail.
 *
 * Shipped to the page by `Function.prototype.toString()`, so the code a test exercises in Node
 * is textually the code that runs in the browser rather than a Node-shaped twin of it that will
 * eventually disagree. That has one consequence worth stating out loud, because it has blanked
 * whole desks: **the comments inside this function are shipped too.** A backtick around a word
 * in a comment here becomes an unterminated template literal in a file that must parse as a
 * classic script, and the parse error takes down every card on the page, not this one.
 * {@link guardEmitted} refuses the build if it happens.
 *
 * Three things genuinely have to happen here rather than in Node:
 *
 *   - the column count and the fit are viewer settings, so they are applied at read time;
 *   - whether a file exists is not knowable in Node -- the path is served by the desk at
 *     runtime and may 404 -- so the failure is caught in the browser and named on the tile;
 *   - enlarging is an interaction.
 *
 * @param sec the card's section
 * @param M   the emitted model: counts and the sentences that quote them
 * @param DEF this instance's fallbacks, same key set as the exported defaults
 */
function imgDraw(sec, M, DEF) {
  var grid = sec.querySelector(".ck-img-grid");
  var note = sec.querySelector(".ck-img-note");

  /* A stored setting is a string out of localStorage, which is a text file the viewer can edit,
     so every one of these is re-derived rather than used. A select gives back a string even for
     a number, which is the ordinary case rather than the attack. */
  function colsOf(v) {
    var k = Math.round(Number(v));
    if (!isFinite(k)) { k = DEF.columns; }
    if (k < 1) { k = 1; }
    if (k > 4) { k = 4; }
    /* One image spanning a quarter of the card is a thumbnail of nothing. A gallery of one is
       just a picture, and a picture takes the whole row. */
    if (M.count < 2) { k = 1; }
    return k;
  }

  function fitOf(v) {
    if (v === "cover" || v === "contain") { return v; }
    return DEF.fit;
  }

  function flag(v, fallback) {
    if (v === true || v === "true" || v === 1) { return true; }
    if (v === false || v === "false" || v === 0) { return false; }
    return fallback;
  }

  /* An image can fail before this script ever runs, and a listener attached afterwards would
     then never fire -- the error event was dispatched at a moment nobody was listening. A
     finished load with no intrinsic width is the same fact, discovered late, so both are
     checked and the tile ends up in the same state either way. */
  function isBroken(img) {
    return img.complete && img.naturalWidth === 0;
  }

  /* The placeholder names the path. A frame that is merely empty tells the reader nothing they
     can act on; a frame that says which file did not arrive is a bug report. */
  function fail(fig) {
    var img = fig.querySelector("img");
    if (!img || fig.getAttribute("data-failed") === "1") { return; }
    var frame = img.parentNode;
    var box = document.createElement("div");
    var head = document.createElement("b");
    var body = document.createElement("span");
    box.className = "ck-img-bad";
    head.textContent = "this image did not load";
    body.textContent = img.getAttribute("data-src") || "no path recorded";
    box.appendChild(head);
    box.appendChild(body);
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", "an image failed to load: " + body.textContent);
    frame.replaceChild(box, img);
    fig.setAttribute("data-failed", "1");
    fig.setAttribute("data-big", "0");
  }

  function shrinkAll() {
    var figs = sec.querySelectorAll(".ck-img-fig");
    var i, btn;
    for (i = 0; i < figs.length; i++) {
      figs[i].setAttribute("data-big", "0");
      btn = figs[i].querySelector(".ck-img-tile");
      if (btn) { btn.setAttribute("aria-expanded", "false"); }
    }
  }

  /* One open tile at a time, on purpose: two half-page images stacked is a scroll, not a
     comparison, and the reader has to close one before the other is legible anyway. */
  function toggle(fig, btn) {
    var open = fig.getAttribute("data-big") === "1";
    shrinkAll();
    if (!open) {
      fig.setAttribute("data-big", "1");
      btn.setAttribute("aria-expanded", "true");
    }
  }

  function wire() {
    var figs = sec.querySelectorAll(".ck-img-fig");
    var i;
    for (i = 0; i < figs.length; i++) {
      wireOne(figs[i]);
    }
    sec.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { shrinkAll(); }
    });
  }

  function wireOne(fig) {
    var img = fig.querySelector("img");
    var btn = fig.querySelector(".ck-img-tile");
    if (img) {
      img.addEventListener("error", function () { fail(fig); });
      if (isBroken(img)) { fail(fig); }
    }
    if (btn) {
      btn.addEventListener("click", function () { toggle(fig, btn); });
    }
  }

  function draw(cfg) {
    var cols = colsOf(cfg.columns);
    var fit = fitOf(cfg.fit);
    var caps = flag(cfg.captions, DEF.captions);

    if (grid) {
      grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      grid.setAttribute("data-fit", fit);
      grid.setAttribute("data-caps", caps ? "1" : "0");
    }
    if (note) {
      if (M.count) {
        note.textContent = cols + " across, " + fit +
          (caps ? ", captions on." : ", captions off.");
      } else {
        note.textContent = M.empty;
      }
    }

    /* Wiring runs once per element, not once per settings change. A swap of the desk's main
       element hands this builder a brand new section with an empty dataset, so the guard
       correctly lets the new one through and correctly refuses the old one a second listener. */
    CK.once(sec, "imgwire", wire);
  }

  CK.settings(sec, DEF, draw);
}

/* ── the guard ────────────────────────────────────────────────────────────────────────── */

/**
 * Blank out comment bodies and string bodies, keeping every offset where it was.
 *
 * This exists because the keyword scan below cried wolf. A card was refused for saying
 * "the class is what CSS reads" in a comment, and a guard that has to be argued with is a guard
 * somebody deletes. Comments and strings are the two places English lives inside code, so they
 * are replaced with spaces before any keyword is looked for.
 *
 * Offsets are preserved rather than the text being cut out, so a reported position still points
 * at the character it names, and newlines survive so a reported line number is the real one.
 *
 * It does not track regular-expression literals, which the emitted scripts do not contain; a
 * slash that is not the start of a comment is simply passed over, so division is safe.
 *
 * @param src source to sanitise
 * @returns the same length of text with every comment and string body turned to spaces
 *
 * @example blankLiterals('var a = "let";');   // 'var a = "   ";'
 */
function blankLiterals(src) {
  const out = src.split('');
  const len = src.length;
  let i = 0;

  const wipe = (j) => { if (src[j] !== '\n') out[j] = ' '; };

  while (i < len) {
    const ch = src[i];
    const nx = src[i + 1];

    if (ch === '/' && nx === '/') {
      let j = i;
      while (j < len && src[j] !== '\n') { wipe(j); j++; }
      i = j;
      continue;
    }
    if (ch === '/' && nx === '*') {
      let j = i;
      while (j < len && !(src[j] === '*' && src[j + 1] === '/')) { wipe(j); j++; }
      if (j < len) { wipe(j); wipe(j + 1); j += 2; }
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < len && src[j] !== ch) {
        if (src[j] === '\\') { wipe(j); wipe(j + 1); j += 2; continue; }
        wipe(j);
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Where an offset falls, said the way a stack trace would say it. */
function atOffset(src, off) {
  const before = src.slice(0, off);
  const line = before.split('\n').length;
  return 'line ' + line + ', offset ' + off;
}

/**
 * Refuse to emit a script that would take the whole desk down.
 *
 * Every card's script is concatenated into ONE inline block, so a single modern-syntax token in
 * one card is a parse error that blanks every card on the page. The hazard that has actually
 * bitten is subtler than writing an arrow function on purpose: the browser halves of these types
 * are shipped by `Function.prototype.toString()`, which carries their comments along, so a
 * backtick typed around a word in a doc comment becomes an unterminated template literal in a
 * file that must be a classic script.
 *
 * Two scans, deliberately different:
 *
 *   - A backtick, an arrow and an optional chain are looked for in the RAW text. None of them
 *     can appear innocently in emitted classic-script code, and a backtick inside a string is
 *     exactly the case worth catching.
 *   - `const`, `let` and `class` are looked for only OUTSIDE comments and strings, because all
 *     three are ordinary English and a guard that fires on prose gets deleted rather than fixed.
 *
 * Exported, unlike the rest of the machinery here, so the guard itself can be tested. A check
 * that has never been shown to fire is a check nobody knows the shape of, and this one has two
 * failure modes worth pinning down: it must catch a backtick that a doc comment carried into
 * the emitted script, and it must NOT catch the word "class" in a sentence.
 *
 * @param js    the emitted script
 * @param where the card's id, so the message says which card
 * @returns the script unchanged, so this can wrap the value on its way out
 * @throws {Error} naming the token and where it is
 *
 * @example guardEmitted('var a = 1;', 'demo');   // 'var a = 1;'
 * @example guardEmitted('var a = `x`;', 'demo'); // throws: a backtick at line 1, offset 8
 */
export function guardEmitted(js, where) {
  const bad = [];

  for (const [needle, what] of [['`', 'a backtick'], ['=>', 'an arrow function'],
                                ['?.', 'optional chaining']]) {
    const at = js.indexOf(needle);
    if (at >= 0) bad.push(what + ' at ' + atOffset(js, at));
  }

  const code = blankLiterals(js);
  for (const word of ['const', 'let', 'class']) {
    const hit = new RegExp('\\b' + word + '\\b').exec(code);
    if (hit) bad.push('the keyword ' + word + ' at ' + atOffset(js, hit.index));
  }

  for (let i = 0; i < js.length; i++) {
    const c = js.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      bad.push('control character ' + c + ' at ' + atOffset(js, i));
      break;
    }
  }

  if (bad.length) {
    throw new Error('cardkit/image: refusing to emit ' + where + ' -- ' + bad.join('; '));
  }
  return js;
}

/**
 * The emitted script: the model, and the browser half that applies it.
 *
 * The function is inlined by `toString()` rather than rewritten as a string literal, so there is
 * one written source for it and a test can call the same text the page runs.
 */
function cardJs(id, model, inst) {
  return '/* image card: settings, enlarge in place, and a named placeholder when a file 404s. */\n' +
    'CK.build(' + jsonLit(id) + ', function (sec) {\n' +
    imgDraw.toString() + '\n' +
    '  imgDraw(sec, ' + jsonLit(model) + ', ' + jsonLit(inst) + ');\n' +
    '});\n';
}

/**
 * Build one image card from one data block.
 *
 * @param id    the card's identity; becomes its `data-card` and its CSS scope
 * @param title the heading, in the card's own words
 * @param data  see {@link meta} for the shape
 * @param ord   display position on the desk; lower sorts earlier, defaults to 50
 * @returns `{ json, html, css, js }` -- `json` carries every refusal count, so a test or a
 *          reader can check what the caption claims
 *
 * @throws {Error} when the emitted script contains a token that would break the desk. Bad input
 *                 never throws: a refused source, a missing alt and an oversized data URI are
 *                 all counted, drawn as a tile, and named in the caption.
 *
 * @example
 * build({
 *   id: 'shots',
 *   title: 'last night&rsquo;s renders',
 *   data: {
 *     columns: 3,
 *     fit: 'cover',
 *     images: [
 *       { src: '/shots/a.png', alt: 'the desk in dark mode', caption: 'build 41' },
 *       { src: '/shots/b.png', alt: 'the same desk in light mode' },
 *     ],
 *   },
 *   ord: 20,
 * });
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'image' : id);
  const R = readData(data);

  const model = {
    count: R.items.length,
    shown: R.items.filter((i) => i.ok).length,
    empty: 'no images were given to this card.',
  };

  /* The instance's own fallbacks. Same key set as the exported `defaults` -- which is what a
     validator checks -- but the columns and the fit start where this card's data said they
     should, so a gallery authored three across opens three across. */
  const inst = { columns: R.cols, fit: R.fit, captions: defaults.captions };

  return {
    json: {
      ord: Number.isFinite(Number(ord)) ? Number(ord) : 50,
      type: 'image',
      asked: R.asked,
      laidOut: R.items.length,
      shown: model.shown,
      columns: R.cols,
      fit: R.fit,
      inlineBytes: R.inline,
      refused: { ...R.counts },
      overflow: R.over,
    },
    html: cardHtml(cardId, title == null ? cardId : clean(title), R),
    css: cardCss(cardId),
    js: guardEmitted(cardJs(cardId, model, inst), cardId),
  };
}
