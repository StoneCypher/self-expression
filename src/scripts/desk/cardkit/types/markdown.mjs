/**
 * The `markdown` card type — a block of Markdown source, rendered as prose on the desk.
 *
 * The rendering happens here, in Node, at build time. That is the whole point of the type:
 * a card whose content is text has no reason to ship a parser to the browser, and the desk's
 * CSP would not load one anyway. `js` comes back empty and the card is inert markup.
 *
 * The subset is deliberately small and hand-written rather than borrowed. A dependency here
 * would be a dependency in the desk's build, and every general-purpose Markdown library is a
 * much larger attack surface than the eight block forms a desk card actually needs. What is
 * supported is listed on {@link meta}; what is not is simply passed through as text.
 *
 * Everything from `data` is escaped before any formatting is applied, so the source is never
 * a way to write markup. Inline syntax is then matched against the *escaped* text, which is
 * safe because escaping only touches `& < > " '` and none of the markers are those. The
 * ordering matters and is the security property: there is no path where user bytes reach the
 * output un-escaped.
 */

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * @example meta.name;   // 'markdown'
 */
export const meta = {
  name: 'markdown',
  summary: 'Renders Markdown source as desk prose, converted in Node so the card ships no script.',
  shape: '{ text } — the Markdown source, treated as untrusted text; missing or empty renders a quiet placeholder'
};

/** The parking sentinel for inline spans that must survive later passes untouched. */
const HOLD = '\u0000';

/** A bullet item: leading indent, `*` or `-`, at least one space, then the content. */
const BULLET = /^([ \t]*)[*-][ \t]+(.*)$/;

/** An ordered item. `)` is accepted alongside `.` because both are in common use. */
const ORDERED = /^([ \t]*)\d{1,9}[.)][ \t]+(.*)$/;

/** Three or more of one rule character, optionally spaced: `---`, `***`, `_ _ _`. */
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** An ATX heading, one to four hashes, with any closing run of hashes discarded. */
const HEADING = /^ {0,3}(#{1,4})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/** An opening code fence, capturing the run length so the close must be at least as long. */
const FENCE = /^ {0,3}(`{3,})[ \t]*([A-Za-z0-9_+.-]*)[ \t]*$/;

/** A blockquote line. */
const QUOTE = /^ {0,3}>/;

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * The browser runtime and this module must agree exactly, or a card would look different
 * depending on which side rendered it — and the two would disagree about what is safe, which
 * is the worse half of that.
 *
 * @param s anything; null and undefined become the empty string rather than their names
 *
 * @example esc('a<b & "c"');   // 'a&lt;b &amp; &quot;c&quot;'
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Split source into lines, normalised for the block scanner.
 *
 * NUL is stripped because the inline pass parks finished spans behind a NUL-delimited
 * marker; source containing one could otherwise forge a marker and have arbitrary parked
 * HTML substituted into its place. Cheaper to remove a character nobody types than to make
 * the marker unforgeable.
 *
 * @param src the Markdown source
 *
 * @example toLines('a\r\nb');   // ['a', 'b']
 */
function toLines(src) {
  return String(src == null ? '' : src).replace(/\0/g, '').replace(/\r\n?/g, '\n').split('\n');
}

/**
 * The href to emit for a link target, or null when the target is not one we will follow.
 *
 * This is the `javascript:` defence and it is an allowlist on purpose: a denylist of bad
 * schemes is a promise to have thought of every scheme, and `data:`, `vbscript:` and
 * `blob:` are only the ones that come to mind tonight. Relative and scheme-relative URLs are
 * dropped too — a desk card is assembled from files and served from a path it does not know,
 * so a relative link could not be resolved meaningfully anyway.
 *
 * @param raw the already-escaped target text from between the parentheses
 * @returns the href, or null to render the link's words as plain text
 *
 * @example safeHref('https://example.com');       // 'https://example.com'
 * @example safeHref('javascript:alert(1)');       // null
 * @example safeHref('#section');                  // '#section'
 */
function safeHref(raw) {
  const url = String(raw).trim();
  if (url === '') return null;
  if (url.charAt(0) === '#') return url;                       // in-page anchor
  if (/^https?:\/\/[^/]/i.test(url)) return url;
  return null;
}

/**
 * Escape a line and apply inline formatting: code, links, bold, italic.
 *
 * Escaping comes first and nothing after it can introduce a `<`, so the passes below only
 * ever wrap text they already own. Code spans and anchor tags are parked behind markers
 * before the emphasis passes run, so a backtick-quoted `**` stays literal and an asterisk
 * inside a URL cannot be read as emphasis.
 *
 * @param raw one line of Markdown, unescaped
 *
 * @example inline('see `x` in **bold**');
 * // 'see <code>x</code> in <strong>bold</strong>'
 */
function inline(raw) {
  const parked = [];
  const park = html => HOLD + (parked.push(html) - 1) + HOLD;

  let s = esc(raw);

  /* Code first, so nothing inside a span is read as syntax. The run length must match on
     both sides, which is how `` ` `` gets written literally. */
  s = s.replace(/(`+)([^\n]*?)\1/g, (m, ticks, body) => park('<code>' + body.trim() + '</code>'));

  /* Only the tags are parked, not the link text: the words between the brackets should still
     get bold and italic, and the href should not.

     The target allows one level of balanced parentheses, which buys two things: a Wikipedia
     URL survives, and a rejected `javascript:alert(1)` is consumed whole instead of leaving
     its closing paren stranded in the prose as visible debris. */
  s = s.replace(/\[([^\]\n]*)\]\(((?:[^()\s\n]|\([^()\s\n]*\))*)\)/g, (m, text, target) => {
    const href = safeHref(target);
    if (href === null) return text;                            // the words survive, the link does not
    const blank = href.charAt(0) === '#' ? '' : ' target="_blank"';
    return park('<a href="' + href + '" rel="noopener noreferrer"' + blank + '>') + text + park('</a>');
  });

  /* Triple markers are matched ahead of double, because `**` would otherwise take two of the
     three asterisks and strand the survivor in the middle of the emphasis it opened. */
  s = s.replace(/\*\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  /* The space guards keep arithmetic prose (`3 * 4 * 5`) out of the emphasis grammar. */
  s = s.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '<em>$1</em>');

  /* One pass suffices: nothing parked contains a marker, so no marker hides behind another. */
  return s.replace(/\0(\d+)\0/g, (m, n) => parked[Number(n)]);
}

/**
 * Join the lines of one paragraph, honouring hard line breaks.
 *
 * Both spellings are accepted — two trailing spaces and a trailing backslash — because the
 * first is invisible in most editors and the second is what people reach for once they have
 * been bitten by that.
 *
 * @param buf the paragraph's lines, in order, none of them blank
 *
 * @example paragraph(['one  ', 'two']);   // 'one<br>two'
 */
function paragraph(buf) {
  return buf.map((line, k) => {
    const last = k === buf.length - 1;
    const hard = !last && /(?: {2,}|\\)$/.test(line);
    return inline(line.replace(/\s+$/, '').replace(/\\$/, '')) + (last ? '' : hard ? '<br>' : ' ');
  }).join('');
}

/**
 * Classify one line as the start of a list item, or not.
 *
 * Tabs are widened before the indent is measured so that a tab-indented nested item and a
 * space-indented one land at the same depth instead of one of them silently flattening.
 *
 * @param line the line to test
 * @returns `{ indent, kind, text }`, or null when the line is not a list item
 *
 * @example listAt('  - deep');   // { indent: 2, kind: 'ul', text: 'deep' }
 */
function listAt(line) {
  const m = BULLET.exec(line) || ORDERED.exec(line);
  if (!m) return null;
  return { indent: m[1].replace(/\t/g, '    ').length, kind: BULLET.test(line) ? 'ul' : 'ol', text: m[2] };
}

/**
 * Consume a run of list lines starting at `start` and render it.
 *
 * Nesting stops at one level, as the type promises: a third level is folded into the second
 * rather than dropped, so deeply indented text still appears — misplaced by one rung, which
 * is a far better failure than vanishing.
 *
 * A single blank line between items keeps the list alive, because that is ordinary
 * authoring; two blanks, or anything that is not another item, ends it.
 *
 * @param lines the whole document's lines
 * @param start index of the first item line
 * @returns `[html, next]` — the rendered list and the index to resume scanning from
 *
 * @example takeList(['- a', '  - b', 'after'], 0);
 * // ['<ul><li>a<ul><li>b</li></ul></li></ul>', 2]
 */
function takeList(lines, start) {
  const kind = listAt(lines[start]).kind;
  const items = [];
  let i = start;

  while (i < lines.length) {
    if (/^\s*$/.test(lines[i])) {
      const after = lines[i + 1];
      if (after === undefined || !listAt(after)) break;
      i++;
      continue;
    }

    const item = listAt(lines[i]);
    if (item) {
      if (item.indent >= 2 && items.length) {
        const owner = items[items.length - 1];
        if (!owner.child) owner.child = { kind: item.kind, items: [] };
        owner.child.items.push(item.text);
      } else {
        if (item.kind !== kind) break;                        // a different marker is a different list
        items.push({ text: item.text, child: null });
      }
      i++;
      continue;
    }

    /* A plain line under an item is that item's continuation — the lazy form, which is how
       most people wrap a long bullet. */
    if (items.length) {
      const owner = items[items.length - 1];
      if (owner.child) owner.child.items[owner.child.items.length - 1] += ' ' + lines[i].trim();
      else owner.text += ' ' + lines[i].trim();
      i++;
      continue;
    }
    break;
  }

  const body = items.map(item => {
    const nested = item.child
      ? '<' + item.child.kind + '>' +
        item.child.items.map(t => '<li>' + inline(t) + '</li>').join('') +
        '</' + item.child.kind + '>'
      : '';
    return '<li>' + inline(item.text) + nested + '</li>';
  }).join('');

  return ['<' + kind + '>' + body + '</' + kind + '>', i];
}

/**
 * Whether a line opens a block, and so ends whatever paragraph is being gathered.
 *
 * @param line the line to test
 *
 * @example opensBlock('## heading');   // true
 */
function opensBlock(line) {
  return FENCE.test(line) || HR.test(line) || HEADING.test(line) || QUOTE.test(line) || !!listAt(line);
}

/**
 * Render a run of lines as block-level HTML.
 *
 * Recursive on blockquotes only, which is what lets a quote hold a list or a heading without
 * the quote handler knowing anything about either.
 *
 * ATX headings become `h3`–`h6` rather than `h1`–`h4`. The card's own title is the `h2` and
 * the desk styles every `h2` as a card label, so a Markdown `#` emitted as `h2` would come
 * out looking like a second card title — and it would break the page's heading order besides.
 *
 * @param lines the lines to render, already normalised
 * @returns the block HTML, empty when there was nothing but whitespace
 *
 * @example blocks(['# Title', '', 'Some *text*.']);
 * // '<h3>Title</h3><p>Some <em>text</em>.</p>'
 */
function blocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const closer = new RegExp('^ {0,3}`{' + fence[1].length + ',}[ \\t]*$');
      const body = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) { body.push(lines[i]); i++; }
      i++;                                                     // step over the close, or past the end
      const lang = fence[2] ? ' class="ck-md-lang-' + esc(fence[2]) + '"' : '';
      out.push('<div class="ck-scroll"><pre><code' + lang + '>' + esc(body.join('\n')) + '</code></pre></div>');
      continue;
    }

    /* Rules are tested before lists, because `- - -` is a legal rule and also parses as a
       one-item bullet if nobody asks first. */
    if (HR.test(line)) { out.push('<hr>'); i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      const tag = 'h' + (heading[1].length + 2);
      out.push('<' + tag + '>' + inline(heading[2]) + '</' + tag + '>');
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i])) {
        buf.push(lines[i].replace(/^ {0,3}> ?/, ''));          // a lazy line keeps its own text
        i++;
      }
      out.push('<blockquote>' + blocks(buf) + '</blockquote>');
      continue;
    }

    if (listAt(line)) {
      const [html, next] = takeList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !opensBlock(lines[i])) { buf.push(lines[i]); i++; }
    out.push('<p>' + paragraph(buf) + '</p>');
  }

  return out.join('');
}

/**
 * Convert Markdown source to HTML.
 *
 * Exported separately from {@link build} so the conversion can be tested and reused without
 * a card around it.
 *
 * @param src the Markdown source; untrusted, and escaped before anything else happens
 * @returns the rendered HTML, or the empty string for source with no content
 *
 * @example toHtml('**hi** <b>');   // '<p><strong>hi</strong> &lt;b&gt;</p>'
 */
export function toHtml(src) {
  return blocks(toLines(src));
}

/**
 * Build one Markdown card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text — never as Markdown, because the
 *              title is chrome and chrome that can be styled by its content is a foothold
 * @param data  `{ text }`, the Markdown source
 * @param ord   the card's position on the desk; non-numbers fall back to 0 rather than
 *              sorting the card to an arbitrary place
 * @returns `{ json, html, css, js }` — `js` is always empty for this type
 *
 * @example
 * build({ id: 'notes', title: 'notes', data: { text: '# hi\n\nthere' }, ord: 40 }).js;   // ''
 */
export function build({ id, title, data, ord }) {
  const body = toHtml(data && data.text) ||
               '<p class="ck-md-empty">nothing to render &mdash; this card has no text</p>';

  const html =
    '<section data-card="' + esc(id) + '" class="ck-markdown">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <div class="ck-md">' + body + '</div>\n' +
    '</section>\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js: '' };
}

/* Every colour here is a desk token, so the theme switch is the only thing that has to know
   anything — and nothing keys off `prefers-color-scheme`, because the desk is one document
   open in two viewers who want different answers and the OS gives both the same one.

   Two type families do the work of separating Markdown's levels. Headings take `--disp`,
   which is the only serif on the desk and reads immediately as "this text was written",
   against the mono card title above it. The deeper two headings drop to `--ui` at label
   scale, matching `.ck-h3` from the kit: below a certain size a serif stops being a voice
   and starts being noise, and weight separates better than scale does anyway. */
const CSS = `
  .ck-markdown .ck-md { font-size: 13px; line-height: 1.6; color: var(--ink); }
  .ck-markdown .ck-md > :first-child { margin-top: 0; }
  .ck-markdown .ck-md > :last-child  { margin-bottom: 0; }
  .ck-markdown .ck-md p { margin: 0 0 10px; }

  .ck-markdown .ck-md h3 { font: 600 16px/1.25 var(--disp); color: var(--ink);      margin: 18px 0 7px; }
  .ck-markdown .ck-md h4 { font: 600 14px/1.3  var(--disp); color: var(--ink);      margin: 16px 0 6px; }
  .ck-markdown .ck-md h5 {
    font: 700 11px/1.3 var(--ui); letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink-dim); margin: 15px 0 5px;
  }
  .ck-markdown .ck-md h6 {
    font: 700 10px/1.3 var(--ui); letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-faint); margin: 14px 0 5px;
  }

  .ck-markdown .ck-md ul, .ck-markdown .ck-md ol { margin: 0 0 10px; padding-left: 21px; }
  .ck-markdown .ck-md li { margin: 2px 0; }
  .ck-markdown .ck-md li::marker { color: var(--ink-faint); }
  /* A nested list is a continuation of its item, not a new block, so it loses the gap. */
  .ck-markdown .ck-md li > ul, .ck-markdown .ck-md li > ol { margin: 3px 0 1px; }

  .ck-markdown .ck-md code {
    font-family: var(--mono); font-size: 11.5px;
    background: var(--pill); border: 1px solid var(--pill-edge); border-radius: 3px;
    padding: 0 4px;
  }
  /* The scroller owns the width; the block keeps its lines whole and lets them run off the
     edge into it, so a long line scrolls this box and never the desk column. */
  .ck-markdown .ck-md .ck-scroll { margin: 0 0 10px; }
  .ck-markdown .ck-md pre {
    margin: 0; padding: 9px 11px; white-space: pre;
    background: var(--well); border: 1px solid var(--hairline); border-radius: 5px;
  }
  .ck-markdown .ck-md pre code {
    background: none; border: 0; padding: 0; line-height: 1.5; color: var(--ink-dim);
  }

  /* The quote is set in by a rule rather than by indent alone: at 13px an indent of any
     honest size is indistinguishable from a list, and the rule says "someone else" outright. */
  .ck-markdown .ck-md blockquote {
    margin: 0 0 10px; padding: 1px 0 1px 12px;
    border-left: 2px solid var(--rule); color: var(--ink-dim);
  }
  .ck-markdown .ck-md blockquote > :last-child { margin-bottom: 0; }

  .ck-markdown .ck-md hr { border: 0; border-top: 1px solid var(--hairline); margin: 16px 0; }

  /* Underline as a border, so it sits clear of the descenders and can change colour on hover
     without the text moving. */
  .ck-markdown .ck-md a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--rule); }
  .ck-markdown .ck-md a:hover { border-bottom-color: var(--accent); }

  .ck-markdown .ck-md strong { font-weight: 700; color: var(--ink); }
  .ck-markdown .ck-md em { font-style: italic; }

  .ck-markdown .ck-md-empty { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
`;
