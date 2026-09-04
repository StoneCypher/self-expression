/**
 * The `diff` card type — a unified diff, per file, with foldable context and a legible wash.
 *
 * The card accepts either already-structured files or raw patch text. When it is handed text it
 * parses it here, in Node, at build time, with a parser written for this file and no dependency
 * behind it. That is the same call `markdown` made and for the same two reasons: a dependency
 * here is a dependency in the desk's build, and the desk's CSP would not load a parser in the
 * browser anyway.
 *
 * Two decisions in here are worth stating because both are usually got wrong.
 *
 * **Colour is never alone.** Added and removed lines carry a background wash *and* a leading
 * `+` or `−`. Red and green are the two hues a deuteranopic reader cannot separate, and that is
 * roughly one man in twelve; a diff that says "green means added" has told those readers
 * nothing. The sigil is the information and the wash is the reinforcement, not the other way
 * round.
 *
 * **The gutters are not selectable.** Line numbers and the sigil are `user-select: none`, so
 * dragging across a hunk and hitting copy yields the code, not code interleaved with numbers
 * that then has to be cleaned by hand. The tradeoff is real and taken deliberately: what comes
 * out is source you can paste into a file, not a patch you can feed to `git apply`. Pasting into
 * a file is the thing people actually do with a diff on a desk.
 *
 * @see parsePatch for what the parser does with a malformed or adversarial patch
 */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * `context` defaults to 0 — every line the patch carried is shown. A patch already arrives with
 * whatever context its author chose; folding it further by default would hide lines somebody
 * deliberately included, which is a strange thing for a viewer to do without being asked.
 *
 * Declared above {@link meta} so `meta.defaults` can be spread from it. The contract wants the
 * settings on `meta`; this file wants them as a named export the emitter can reach. Spreading one
 * from the other means there is still only one place a default is written down.
 *
 * @example defaults.context;   // 0
 */
export const defaults = { wrap: true, context: 0, collapsed: false };

/**
 * What this type is and what it eats, for the type registry's listing.
 *
 * @example meta.name;       // 'diff'
 * @example meta.defaults;   // { wrap: true, context: 0, collapsed: false }
 */
export const meta = {
  name: 'diff',
  summary: 'A unified diff with per-file collapse, foldable context, and washes that never carry meaning alone.',
  shape: '{ files: [{ path, from, hunks: [{ header, lines: [{ kind, text, oldNo, newNo }] }], added, removed }] } ' +
         'or { patch: "<unified diff text>" }, which is parsed here at build time; kind is add | del | ctx | meta',
  category: 'text-and-code',
  defaults: { ...defaults }
};

/** The four line kinds the renderer knows; anything else is treated as context. */
const KINDS = { add: 1, del: 1, ctx: 1, meta: 1 };

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script and not a module. Diff
 * text is the most hostile input on the desk — it is, by construction, somebody else's source
 * code, brackets and quotes and all — so this is the only route by which any of it reaches the
 * page.
 *
 * @param s anything; null and undefined become the empty string rather than their names
 *
 * @example esc('<script>');   // '&lt;script&gt;'
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * A JavaScript string literal for a value, safe to paste into the emitted classic script.
 *
 * See `table.mjs` for the full reasoning; briefly: `</` would close the script element,
 * U+2028/9 terminate a JS line but not a JSON one, and the backtick and question mark are
 * escaped so that data can never spell a token the type's own tests forbid.
 *
 * @param s the text to embed
 *
 * @example jsStr('a</script>b');   // '"a\\u003c/script\\u003eb"'
 */
function jsStr(s) {
  return JSON.stringify(String(s == null ? '' : s))
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/`/g, '\\u0060').replace(/\?/g, '\\u003f')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Undo git's C-style quoting of a path containing awkward bytes.
 *
 * Git writes `"src/a\tb.js"` when a path holds a tab, a quote or a non-ASCII byte. Only the
 * escapes git actually emits are handled; an octal escape is left as written rather than
 * guessed at, since a wrong guess would silently rename the file in the display.
 *
 * @param s the contents of the quotes, without them
 *
 * @example unquote('a\\tb');   // 'a\tb'
 */
function unquote(s) {
  return s.replace(/\\([\\"nt])/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/**
 * Drop the `a/` or `b/` prefix git puts in front of a path, for the side it belongs to.
 *
 * Side-specific — `a/` only from the old side, `b/` only from the new — because that is what
 * `-p1` does, and it is the only reading that leaves a repository-root file genuinely named
 * `b/thing` alone on the side where `b/` cannot be a prefix.
 *
 * @param p    the path as written
 * @param side 'a' for the old side, 'b' for the new
 *
 * @example stripSide('a/src/x.js', 'a');   // 'src/x.js'
 * @example stripSide('a/src/x.js', 'b');   // 'a/src/x.js'
 */
function stripSide(p, side) {
  return p.indexOf(side + '/') === 0 ? p.slice(2) : p;
}

/**
 * A bare path from a `rename from` / `rename to` line.
 *
 * These carry no `a/` or `b/` prefix, so stripping one here would eat the first directory of a
 * repository that happens to have a top-level `a` — which is a real directory name in more
 * projects than one would like.
 *
 * @param s everything after the keyword
 *
 * @example plainPath('"old\\tname.js"');   // 'old\tname.js'
 */
function plainPath(s) {
  const p = String(s).replace(/\s+$/, '');
  return p.length > 1 && p.charAt(0) === '"' && p.charAt(p.length - 1) === '"' ? unquote(p.slice(1, -1)) : p;
}

/**
 * The path named on a `---` or `+++` line, or null for `/dev/null`.
 *
 * A trailing tab and timestamp, which plain `diff -u` emits and git does not, is dropped.
 *
 * @param s    everything after the marker and its space
 * @param side 'a' for the old side, 'b' for the new
 * @returns the path, or null when this side of the change has no file
 *
 * @example sidePath('a/src/x.js\t2026-01-01', 'a');   // 'src/x.js'
 * @example sidePath('/dev/null', 'a');                // null
 */
function sidePath(s, side) {
  const p = plainPath(String(s).split('\t')[0]);
  return p === '/dev/null' ? null : stripSide(p, side);
}

/**
 * The two paths on a `diff --git` line.
 *
 * Genuinely ambiguous when a filename contains a space, because the line is two paths separated
 * by one. Three readings are tried in order of confidence: a fully quoted pair, which git emits
 * exactly when the name is awkward; the identical-path case, which is the overwhelming majority
 * and can be confirmed by the halves matching; and finally a split at the last ` b/`. The header
 * is only ever a fallback anyway — the `---` and `+++` lines that follow are unambiguous, and
 * this matters solely for mode-only, rename-only and binary changes, which have none.
 *
 * @param rest everything after `diff --git `
 * @returns `[oldPath, newPath]`
 *
 * @example gitPair('a/x.js b/x.js');       // ['x.js', 'x.js']
 * @example gitPair('a/old.js b/new.js');   // ['old.js', 'new.js']
 */
function gitPair(rest) {
  const quoted = /^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (quoted) return [stripSide(unquote(quoted[1]), 'a'), stripSide(unquote(quoted[2]), 'b')];

  const same = /^a\/(.+) b\/\1$/.exec(rest);
  if (same) return [same[1], same[1]];

  const at = rest.lastIndexOf(' b/');
  if (at > 0) return [sidePath(rest.slice(0, at), 'a'), rest.slice(at + 3)];

  return [rest, rest];
}

/** A fresh, empty file record. */
function newFile() {
  return { path: '', from: null, oldPath: null, newPath: null, status: '', binary: false,
           hunks: [], added: 0, removed: 0, sawMinus: false, sawPlus: false };
}

/**
 * Settle a file's display path, status and counts once no more of its lines will arrive.
 *
 * `status` is only inferred when the patch did not say. An explicit `new file mode` or
 * `rename from` outranks the `/dev/null` reading, because the explicit line is the one git
 * writes when it knows and the inference is what is left when nobody said.
 *
 * @param f the record to finish, mutated in place
 *
 * @example const f = newFile(); f.oldPath = 'a'; f.newPath = 'b'; finish(f); f.status;   // 'renamed'
 */
function finish(f) {
  for (const h of f.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') f.added++;
      else if (l.kind === 'del') f.removed++;
    }
  }

  if (!f.status) {
    if (f.newPath === null && f.oldPath !== null) f.status = 'deleted';
    else if (f.oldPath === null && f.newPath !== null) f.status = 'added';
    else if (f.oldPath && f.newPath && f.oldPath !== f.newPath) f.status = 'renamed';
    else f.status = 'modified';
  }

  f.path = f.newPath || f.oldPath || '(unknown)';
  /* `from` is only set when the two sides genuinely name different files, so the renderer can
     show `old → new` without having to re-derive what a rename is. */
  f.from = f.oldPath && f.newPath && f.oldPath !== f.newPath ? f.oldPath : null;

  delete f.sawMinus;
  delete f.sawPlus;
}

/**
 * Parse unified diff text into the card's file/hunk/line shape.
 *
 * The one structural rule that makes this parser correct rather than merely usual: **inside a
 * hunk, the counts in the `@@` header are the authority, not the first character of the line.**
 * A hunk that declares four old and five new lines consumes exactly that many, and only once the
 * budget is spent does a line become eligible to be read as a file header again.
 *
 * That rule is what makes a removed line whose content is `-- ` — which arrives on the wire as
 * the four bytes `--- ` — parse as a deletion instead of tearing the file record in half. There
 * is a second, independent guard for the same case: a `---` header must be followed by a
 * non-empty path, so a bare `--- ` is not a header even when the budget has been misdeclared.
 * Two defences, because the failure is silent and produces a plausible-looking wrong answer.
 *
 * When the counts turn out to be wrong — a truncated paste, a hand-edited patch — the hunk is
 * closed at the first line that does not fit and the line is re-read as structure. Losing the
 * tail of one hunk is a better failure than swallowing the rest of the patch into it.
 *
 * Not handled, on purpose: combined diffs (`@@@`, from a merge), which have a different line
 * grammar entirely, and git's binary patch payloads, which are noted as binary and skipped.
 *
 * @param text unified diff text, git-flavoured or plain; CRLF is normalised
 * @returns one record per file, each with `path`, `from`, `status`, `hunks`, `added`, `removed`
 *
 * @example
 * parsePatch('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')[0].removed;   // 1
 *
 * @example
 * // a deleted line whose text is '-- ' is content, not a header
 * parsePatch('--- a/x\n+++ b/x\n@@ -1,1 +1,0 @@\n--- \n')[0].hunks[0].lines[0];
 * // { kind: 'del', text: '-- ', oldNo: 1, newNo: null }
 */
export function parsePatch(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const files = [];

  let f = null, hunk = null;
  let oldLeft = 0, newLeft = 0, oldNo = 0, newNo = 0;

  const start = () => { f = newFile(); files.push(f); return f; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* "\ No newline at end of file" belongs to neither side and counts against neither, which
       means it routinely arrives *after* the hunk's budget is spent — it annotates the last line,
       and the last line is often the last line. Tested before the budget gate for exactly that
       reason; gating it would drop the marker on every file that ends without a newline. */
    if (hunk && line.charAt(0) === '\\') {
      hunk.lines.push({ kind: 'meta', text: line.slice(1).trim(), oldNo: null, newNo: null });
      continue;
    }

    /* Inside a live hunk the line is content, whatever it looks like. */
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line.charAt(0);

      if (c === '+' && newLeft > 0) {
        hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ });
        newLeft--;
        continue;
      }
      if (c === '-' && oldLeft > 0) {
        hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null });
        oldLeft--;
        continue;
      }
      /* A wholly empty line is a context line whose trailing space was stripped somewhere
         between here and the author — by a mailer, an editor, a copy out of a terminal. Every
         real-world patch has some. */
      if ((c === ' ' || line === '') && oldLeft > 0 && newLeft > 0) {
        hunk.lines.push({ kind: 'ctx', text: line === '' ? '' : line.slice(1), oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
        continue;
      }

      /* The header lied, or the patch is cut short. Close the hunk and fall through so the line
         gets a fair reading as structure. */
      hunk = null;
      oldLeft = 0;
      newLeft = 0;
    }

    const git = /^diff --git (.+)$/.exec(line);
    if (git) {
      if (f) finish(f);
      const pair = gitPair(git[1]);
      start();
      f.oldPath = pair[0];
      f.newPath = pair[1];
      hunk = null;
      continue;
    }

    /* The `(.+)` is load-bearing: it is what stops a bare `--- ` from being read as a header. */
    const minus = /^--- (.+)$/.exec(line);
    if (minus) {
      if (!f || f.sawPlus) { if (f) finish(f); start(); }
      f.oldPath = sidePath(minus[1], 'a');
      f.sawMinus = true;
      hunk = null;
      continue;
    }

    const plus = /^\+\+\+ (.+)$/.exec(line);
    if (plus) {
      if (!f) start();
      f.newPath = sidePath(plus[1], 'b');
      f.sawPlus = true;
      hunk = null;
      continue;
    }

    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (head) {
      if (!f) start();
      oldNo   = Number(head[1]);
      oldLeft = head[2] === undefined ? 1 : Number(head[2]);
      newNo   = Number(head[3]);
      newLeft = head[4] === undefined ? 1 : Number(head[4]);
      hunk = { header: line, lines: [] };
      f.hunks.push(hunk);
      continue;
    }

    if (/^rename from /.test(line))   { if (!f) start(); f.oldPath = plainPath(line.slice(12)); f.status = 'renamed'; continue; }
    if (/^rename to /.test(line))     { if (!f) start(); f.newPath = plainPath(line.slice(10)); f.status = 'renamed'; continue; }
    if (/^new file mode /.test(line)) { if (!f) start(); f.status = 'added';   continue; }
    if (/^deleted file mode /.test(line)) { if (!f) start(); f.status = 'deleted'; continue; }
    if (/^(Binary files |GIT binary patch)/.test(line)) { if (!f) start(); f.binary = true; continue; }

    /* Everything else outside a hunk — `index`, mode changes, similarity, a commit message
       above the patch — is noise this card has nothing to say about. */
  }

  if (f) finish(f);
  return files;
}

/**
 * Coerce caller-supplied `files` into the shape the renderer relies on.
 *
 * Written defensively because this is the path that does *not* go through the parser: a caller
 * handing over structured files can hand over anything, and the renderer should not be the place
 * that discovers `lines` was a string.
 *
 * @param raw the caller's `files`
 * @returns records with the same fields {@link parsePatch} produces
 *
 * @example normalize([{ path: 'x', hunks: [] }])[0].added;   // 0
 */
function normalize(raw) {
  const list = Array.isArray(raw) ? raw.filter((f) => f && typeof f === 'object') : [];

  return list.map((f) => {
    const hunks = (Array.isArray(f.hunks) ? f.hunks : []).filter((h) => h && typeof h === 'object').map((h) => ({
      header: h.header == null ? '' : String(h.header),
      lines: (Array.isArray(h.lines) ? h.lines : []).filter((l) => l && typeof l === 'object').map((l) => ({
        kind:  KINDS[l.kind] ? String(l.kind) : 'ctx',
        text:  l.text == null ? '' : String(l.text),
        oldNo: Number.isFinite(l.oldNo) ? l.oldNo : null,
        newNo: Number.isFinite(l.newNo) ? l.newNo : null
      }))
    }));

    let added = 0, removed = 0;
    for (const h of hunks) for (const l of h.lines) {
      if (l.kind === 'add') added++;
      else if (l.kind === 'del') removed++;
    }

    return {
      path:    f.path == null ? '(unknown)' : String(f.path),
      from:    f.from == null ? null : String(f.from),
      status:  f.status == null ? '' : String(f.status),
      binary:  !!f.binary,
      hunks,
      /* Counts are trusted when supplied — a caller who has the real numbers may know about
         lines that were elided before the card ever saw them — and derived when not. */
      added:   Number.isFinite(f.added)   ? f.added   : added,
      removed: Number.isFinite(f.removed) ? f.removed : removed
    };
  });
}

/** The file-header caret, drawn: a chevron that turns rather than an emoji triangle. */
const CARET = '<svg class="ck-df-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M6 9l6 6 6-6"/></svg>';

/**
 * One rendered line row.
 *
 * The two gutters are always emitted even when a side has no number, so the four columns stay in
 * register down the whole file; an added line with a missing old-number cell would shift its
 * text left of every context line around it.
 *
 * @param l a normalised line
 *
 * @example line({ kind: 'add', text: 'x', oldNo: null, newNo: 4 });
 * // '<div class="ck-df-line" data-kind="add">…</div>'
 */
function line(l) {
  const sig = l.kind === 'add' ? '+' : l.kind === 'del' ? '&minus;' : l.kind === 'meta' ? '\\' : ' ';
  const o = l.oldNo === null ? '' : String(l.oldNo);
  const n = l.newNo === null ? '' : String(l.newNo);
  return '<div class="ck-df-line" data-kind="' + l.kind + '">' +
         '<span class="ck-df-n ck-df-n1" aria-hidden="true">' + o + '</span>' +
         '<span class="ck-df-n ck-df-n2" aria-hidden="true">' + n + '</span>' +
         '<span class="ck-df-sig" aria-hidden="true">' + sig + '</span>' +
         '<code class="ck-df-tx">' + esc(l.text) + '</code></div>';
}

/**
 * One rendered file block: header, then hunks, then whatever the header promised.
 *
 * Rendered open. `collapsed` is a per-viewer setting and is applied by the script on load, so
 * the markup carries the state that is true for a reader without one.
 *
 * @param f a normalised file record
 *
 * @example renderFile({ path: 'x', hunks: [], added: 0, removed: 0, status: 'added', binary: false, from: null });
 */
function renderFile(f) {
  const path = f.from
    ? '<span class="ck-df-was">' + esc(f.from) + '</span> &rarr; ' + esc(f.path)
    : esc(f.path);

  const tag = f.binary ? 'binary'
            : f.status && f.status !== 'modified' ? f.status
            : '';

  const body = f.binary
    ? '<div class="ck-df-none">binary file &mdash; no line changes to show</div>'
    : f.hunks.length === 0
      ? '<div class="ck-df-none">no line changes</div>'
      : '<div class="ck-df-lines">' + f.hunks.map((h) =>
          '<div class="ck-df-hunk">' +
          '<div class="ck-df-hh"><code>' + esc(h.header) + '</code></div>' +
          h.lines.map(line).join('') +
          '</div>'
        ).join('') + '</div>';

  return '<div class="ck-df-file" data-open="1">' +
         '<button type="button" class="ck-df-head" aria-expanded="true">' + CARET +
         '<span class="ck-df-path">' + path + '</span>' +
         (tag ? '<span class="ck-df-tag">' + esc(tag) + '</span>' : '') +
         '<span class="ck-df-stat"><b class="a">+' + f.added + '</b> <b class="d">&minus;' + f.removed + '</b></span>' +
         '</button>' +
         '<div class="ck-scroll ck-df-body">' + body + '</div>' +
         '</div>';
}

/**
 * The card's browser half.
 *
 * Everything it does is a rearrangement of markup that already exists: it hides context lines,
 * injects a fold button in their place, toggles a wrap class, and opens or closes a file. No
 * diff content is ever built here, so the escaping done in Node is the only escaping there is.
 *
 * @param id the card's `data-card` value, embedded as a literal
 *
 * @example main('pr').indexOf('CK.build') >= 0;   // true
 */
function main(id) {
  return [
    '  /* Our own markup, not data: three round-capped zero-length strokes read as an ellipsis at',
    '     any size, where a typed one is a font lottery and an emoji is worse. */',
    '  var CK_D_DOTS = \'<svg class="ck-df-dots" viewBox="0 0 24 24" fill="none" stroke="currentColor" \' +',
    '    \'stroke-width="2.6" stroke-linecap="round" aria-hidden="true">\' +',
    '    \'<path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>\';',
    '',
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var files = sec.querySelectorAll(".ck-df-file");',
    '',
    '    /* Remembered across renders so that nudging the context setting does not slam every file',
    '       the reader had opened by hand. Only a real change to collapsed speaks for all. */',
    '    var lastCollapsed = null;',
    '',
    '    function openFile(file, open) {',
    '      file.setAttribute("data-open", open ? "1" : "0");',
    '      var head = file.querySelector(".ck-df-head");',
    '      if (head) head.setAttribute("aria-expanded", open ? "true" : "false");',
    '    }',
    '',
    '    function makeFold(gone) {',
    '      var b = document.createElement("button");',
    '      b.type = "button";',
    '      b.className = "ck-df-fold";',
    '      b.insertAdjacentHTML("afterbegin", CK_D_DOTS);',
    '      var label = document.createElement("span");',
    '      label.textContent = gone.length + (gone.length === 1 ? " unchanged line" : " unchanged lines");',
    '      b.appendChild(label);',
    '      b.addEventListener("click", function () {',
    '        for (var k = 0; k < gone.length; k++) gone[k].hidden = false;',
    '        if (b.parentNode) b.parentNode.removeChild(b);',
    '      });',
    '      return b;',
    '    }',
    '',
    '    function unfold(root) {',
    '      var olds = root.querySelectorAll(".ck-df-fold"), k;',
    '      for (k = 0; k < olds.length; k++) olds[k].parentNode.removeChild(olds[k]);',
    '      var rows = root.querySelectorAll(".ck-df-line");',
    '      for (k = 0; k < rows.length; k++) rows[k].hidden = false;',
    '    }',
    '',
    '    function foldHunk(hunk, n) {',
    '      var kids = hunk.children, runs = [], run = null, first = null, last = null, k;',
    '',
    '      for (k = 0; k < kids.length; k++) {',
    '        var el = kids[k];',
    '        if (el.className.indexOf("ck-df-line") < 0) { run = null; continue; }',
    '        if (!first) first = el;',
    '        last = el;',
    '        if (el.getAttribute("data-kind") === "ctx") {',
    '          if (!run) { run = []; runs.push(run); }',
    '          run.push(el);',
    '        } else run = null;',
    '      }',
    '',
    '      for (k = 0; k < runs.length; k++) {',
    '        var list = runs[k];',
    '        /* A run at the top of a hunk has nothing above it to give context to, and one at the',
    '           bottom nothing below, so those keep context on one side only. */',
    '        var from = list[0] === first ? 0 : n;',
    '        var to   = list[list.length - 1] === last ? list.length : list.length - n;',
    '        /* Below two lines the fold button is taller than what it hides. */',
    '        if (to - from < 2) continue;',
    '        var gone = [], j;',
    '        for (j = from; j < to; j++) { list[j].hidden = true; gone.push(list[j]); }',
    '        hunk.insertBefore(makeFold(gone), gone[0]);',
    '      }',
    '    }',
    '',
    '    function fold(n) {',
    '      var i, k;',
    '      for (i = 0; i < files.length; i++) {',
    '        var body = files[i].querySelector(".ck-df-body");',
    '        if (!body) continue;',
    '        unfold(body);',
    '        if (n <= 0) continue;',
    '        var hunks = body.querySelectorAll(".ck-df-hunk");',
    '        for (k = 0; k < hunks.length; k++) foldHunk(hunks[k], n);',
    '      }',
    '    }',
    '',
    '    CK.once(sec, "dfhead", function () {',
    '      sec.addEventListener("click", function (ev) {',
    '        var head = ev.target && ev.target.closest ? ev.target.closest(".ck-df-head") : null;',
    '        if (!head) return;',
    '        var file = head.parentNode;',
    '        openFile(file, file.getAttribute("data-open") === "0");',
    '      });',
    '    });',
    '',
    '    CK.settings(sec, ' + JSON.stringify(defaults) + ', function (cfg) {',
    '      sec.classList.toggle("ck-df-wrapped", !!cfg.wrap);',
    '      var c = Math.floor(Number(cfg.context));',
    '      fold(isFinite(c) && c > 0 ? c : 0);',
    '      var want = !!cfg.collapsed;',
    '      if (lastCollapsed !== want) {',
    '        lastCollapsed = want;',
    '        for (var i = 0; i < files.length; i++) openFile(files[i], !want);',
    '      }',
    '    });',
    '  });'
  ].join('\n');
}

/**
 * Build one diff card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ files }` or `{ patch }`; `files` wins when both are present, since a caller
 *              who has already structured the diff has done the more accurate thing
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'pr', title: 'pr 47', ord: 20, data: { patch: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' } })
 *   .html.indexOf('+1') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};
  const files = Array.isArray(d.files) && d.files.length
    ? normalize(d.files)
    : normalize(parsePatch(d.patch));

  let added = 0, removed = 0;
  for (const f of files) { added += f.added; removed += f.removed; }

  const body = files.length
    ? files.map(renderFile).join('\n  ')
    : '<div class="ck-df-void">nothing to render &mdash; this card has no diff</div>';

  const cap = files.length
    ? esc(files.length + (files.length === 1 ? ' file' : ' files')) +
      ', <b>+' + added + '</b> <b>&minus;' + removed + '</b>' +
      ' <i class="ck-aside">line numbers and the +/&minus; column are not selectable, so a copied hunk is source</i>'
    : 'no files in this diff';

  const html =
    '<section data-card="' + esc(id) + '" class="ck-diff">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-wrap">wrap long lines</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-wrap" name="wrap">\n' +
    '    <label for="' + esc(id) + '-context">context lines</label>\n' +
    '    <input type="number" id="' + esc(id) + '-context" name="context" min="0" max="99" step="1">\n' +
    '    <label for="' + esc(id) + '-collapsed">start collapsed</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-collapsed" name="collapsed">\n' +
    '    <div class="ck-set-foot">0 context lines shows every unchanged line the patch carried. unwrapped lines scroll inside their own file.</div>\n' +
    '  </div>\n' +
    '  ' + body + '\n' +
    '  <div class="ck-cap">' + cap + '</div>\n' +
    '</section>\n';

  const js = '(function () {\n' + main(id) + '\n})();\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/* Not one literal colour in this file, which took a little arranging.
 *
 * The obvious way to write a diff wash is to pick a pale green and a pale red, and it is wrong
 * twice over: it hard-codes two colours the desk did not choose, and a wash tuned against
 * near-black is far too strong against white. What is here instead mixes the desk's own series
 * tokens — s4 for added, s1 for removed, the same green and coral every chart on the desk uses —
 * into transparency, at a *percentage* that the theme is allowed to change. A percentage is not
 * a colour, so the light-mode override below carries no colour either, and the whole file stays
 * inside the token vocabulary.
 *
 * Nothing keys off `prefers-color-scheme`: the desk is one document open in two viewers who want
 * different answers, and the OS only knows how to give both of them the same one.
 */
const CSS = `
  .ck-diff {
    position: relative;
    --ck-d-num: 3.3em;   /* gutter width; two of these, so it pays to name it */
    --ck-d-w1: 16%;      /* the line wash */
    --ck-d-w2: 27%;      /* the number gutter, a shade stronger so the edge of the change reads */
  }
  /* A wash that reads as a tint on near-black reads as paint on white, so light mode takes less
     of the same hue rather than a different colour. */
  :root[data-theme="light"] .ck-diff { --ck-d-w1: 11%; --ck-d-w2: 20%; }

  .ck-diff .ck-set input[type="checkbox"] { width: auto; justify-self: start; margin: 0; }

  /* ── the file, and its header ───────────────────────────────────────────────────────── */

  .ck-diff .ck-df-file {
    margin-top: 10px; overflow: hidden;
    border: 1px solid var(--hairline); border-radius: 6px;
  }
  .ck-diff .ck-df-head {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 10px; cursor: pointer; text-align: left;
    font: inherit; font-family: var(--mono); font-size: 11px; color: var(--ink);
    background: var(--well); border: 0; border-bottom: 1px solid var(--hairline);
  }
  .ck-diff .ck-df-head:hover { color: var(--accent); }
  .ck-diff .ck-df-head:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
  .ck-diff .ck-df-file[data-open="0"] .ck-df-head { border-bottom: 0; }
  .ck-diff .ck-df-file[data-open="0"] .ck-df-body { display: none; }

  .ck-diff .ck-df-caret { width: 12px; height: 12px; flex: none; color: var(--ink-faint); transition: transform .12s; }
  .ck-diff .ck-df-file[data-open="0"] .ck-df-caret { transform: rotate(-90deg); }

  /* The path takes the slack. It is not reversed with direction: rtl to ellipsise from the left,
     tempting as that is: the trick reorders punctuation, and a rename header here reads
     old arrow new, which that would silently turn into nonsense. */
  .ck-diff .ck-df-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ck-diff .ck-df-was { color: var(--ink-faint); }

  .ck-diff .ck-df-tag {
    flex: none; padding: 1px 5px; border-radius: 3px;
    font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase;
    color: var(--ink-faint); background: var(--pill); border: 1px solid var(--pill-edge);
  }
  .ck-diff .ck-df-stat { flex: none; font-variant-numeric: tabular-nums; }
  .ck-diff .ck-df-stat .a { color: var(--ck-s4); font-weight: 400; }
  .ck-diff .ck-df-stat .d { color: var(--ck-s1); font-weight: 400; }

  /* ── the lines ──────────────────────────────────────────────────────────────────────── */

  .ck-diff .ck-df-body { background: var(--ground); }

  /* Unwrapped, this block is as wide as its widest line and every line fills it, so a short
     line's wash still runs the full width of the scroll rather than stopping at its text. */
  .ck-diff .ck-df-lines { width: max-content; min-width: 100%; }
  .ck-diff.ck-df-wrapped .ck-df-lines { width: auto; min-width: 0; }

  .ck-diff .ck-df-line {
    display: grid;
    grid-template-columns: var(--ck-d-num) var(--ck-d-num) 1.15em minmax(0, 1fr);
    font-family: var(--mono); font-size: 11px; line-height: 1.55;
  }
  /* [hidden] ties with the rule above on specificity and this sheet loads later, so a folded
     line would stay on screen without this saying otherwise. */
  .ck-diff .ck-df-line[hidden] { display: none; }

  /* The whole point of the two gutters: they are chrome, not content. Copying across a hunk
     yields the code and not a column of numbers glued to the front of every line. */
  .ck-diff .ck-df-n {
    text-align: right; padding-right: 8px;
    color: var(--ink-faint); font-variant-numeric: tabular-nums;
    -webkit-user-select: none; user-select: none;
  }
  .ck-diff .ck-df-n2 { border-right: 1px solid var(--hairline); }
  .ck-diff .ck-df-sig {
    text-align: center; color: var(--ink-faint);
    -webkit-user-select: none; user-select: none;
  }
  .ck-diff .ck-df-tx { white-space: pre; padding: 0 10px 0 3px; color: var(--ink); }
  .ck-diff.ck-df-wrapped .ck-df-tx { white-space: pre-wrap; overflow-wrap: anywhere; }

  /* Wash plus sigil, never wash alone. Roughly one man in twelve cannot separate these two hues,
     and for that reader the + and the − are the entire message. */
  .ck-diff .ck-df-line[data-kind="add"] { background: color-mix(in oklab, var(--ck-s4) var(--ck-d-w1), transparent); }
  .ck-diff .ck-df-line[data-kind="del"] { background: color-mix(in oklab, var(--ck-s1) var(--ck-d-w1), transparent); }
  .ck-diff .ck-df-line[data-kind="add"] .ck-df-n { background: color-mix(in oklab, var(--ck-s4) var(--ck-d-w2), transparent); }
  .ck-diff .ck-df-line[data-kind="del"] .ck-df-n { background: color-mix(in oklab, var(--ck-s1) var(--ck-d-w2), transparent); }
  .ck-diff .ck-df-line[data-kind="add"] .ck-df-sig { color: var(--ck-s4); font-weight: 700; }
  .ck-diff .ck-df-line[data-kind="del"] .ck-df-sig { color: var(--ck-s1); font-weight: 700; }
  .ck-diff .ck-df-line[data-kind="meta"] { color: var(--ink-faint); }
  .ck-diff .ck-df-line[data-kind="meta"] .ck-df-tx { color: var(--ink-faint); font-style: italic; }

  /* ── hunk headers and folds ─────────────────────────────────────────────────────────── */

  .ck-diff .ck-df-hh {
    padding: 3px 10px; border-top: 1px solid var(--hairline);
    background: var(--well); color: var(--ink-faint);
    font-family: var(--mono); font-size: 10.5px;
  }
  .ck-diff .ck-df-hunk:first-child .ck-df-hh { border-top: 0; }
  .ck-diff .ck-df-hh code { white-space: pre; }

  .ck-diff .ck-df-fold {
    display: flex; align-items: center; gap: 7px; width: 100%;
    padding: 3px 10px; cursor: pointer; text-align: left;
    font: inherit; font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint);
    background: var(--well); border: 0;
    border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
  }
  .ck-diff .ck-df-fold:hover { color: var(--accent); }
  .ck-diff .ck-df-dots { width: 13px; height: 13px; flex: none; }

  .ck-diff .ck-df-none, .ck-diff .ck-df-void {
    padding: 9px 11px; font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }
  .ck-diff .ck-df-void { padding-left: 0; }

  @media (prefers-reduced-motion: reduce) {
    /* The caret's turn is decoration; aria-expanded and the hidden body carry the meaning. */
    .ck-diff .ck-df-caret { transition: none; }
  }
`;
