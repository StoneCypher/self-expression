(function () {
  'use strict';

  var CK_CODE_LANGS = {"plain":{"flags":"","rules":[{"cls":"plain","re":"[\\s\\S]+"}]},"javascript":{"flags":"","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"comment","re":"//[^\\n]*"},{"cls":"comment","re":"/\\*[\\s\\S]*?(?:\\*/|$)"},{"cls":"string","re":"\\u0060","scan":"template","split":"template"},{"cls":"string","re":"\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*(?:\"|(?=\\n)|$)"},{"cls":"string","re":"'(?:\\\\[\\s\\S]|[^'\\\\\\n])*(?:'|(?=\\n)|$)"},{"cls":"string","re":"/(?![*/=])(?:\\\\[\\s\\S]|\\[(?:\\\\[\\s\\S]|[^\\]\\\\\\n])*\\]|[^/\\\\\\n\\[])+/[dgimsuvy]*","guard":"jsregex","rej":{"cls":"operator","n":1}},{"cls":"number","re":"0[xX][0-9a-fA-F][0-9a-fA-F_]*n?|0[bB][01][01_]*n?|0[oO][0-7][0-7_]*n?|(?:\\d[\\d_]*(?:\\.[\\d_]*)?|\\.\\d[\\d_]*)(?:[eE][+-]?\\d+)?n?"},{"cls":"keyword","re":"\\b(?:instanceof|undefined|function|continue|debugger|default|extends|finally|return|switch|de\u006cete|typeof|\u0069mport|\u0065xport|static|\u0063onst|while|break|false|class|super|async|await|yield|catch|throw|else|case|this|null|true|from|void|with|var|\u006cet|for|new|try|if|do|in|of|as)\\b"},{"cls":"type","re":"\\b(?:globalThis|arguments|document|Infinity|console|window|NaN)\\b"},{"cls":"function","re":"[A-Za-z_$][\\w$]*(?=\\s*\\()"},{"cls":"type","re":"[A-Z][\\w$]*"},{"cls":"plain","re":"[A-Za-z_$][\\w$]*"},{"cls":"operator","re":"=\u003e|\\.\\.\\.|\\?\\?=?|\\?\\.(?!\\d)|===|!==|==|!=|\u003c\u003c=|\u003e\u003e\u003e=|\u003e\u003e=|\u003e\u003e\u003e|\u003c\u003c|\u003e\u003e|\u003c=|\u003e=|&&=|\\|\\|=|\\*\\*=|\\*\\*|\\+\\+|--|[+\\-*/%&|^]=|&&|\\|\\||=|[+\\-*/%\u003c\u003e!~&|^?:]"},{"cls":"punctuation","re":"[{}()\\[\\];,.]"}]},"typescript":{"flags":"","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"comment","re":"//[^\\n]*"},{"cls":"comment","re":"/\\*[\\s\\S]*?(?:\\*/|$)"},{"cls":"string","re":"\\u0060","scan":"template","split":"template"},{"cls":"string","re":"\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*(?:\"|(?=\\n)|$)"},{"cls":"string","re":"'(?:\\\\[\\s\\S]|[^'\\\\\\n])*(?:'|(?=\\n)|$)"},{"cls":"string","re":"/(?![*/=])(?:\\\\[\\s\\S]|\\[(?:\\\\[\\s\\S]|[^\\]\\\\\\n])*\\]|[^/\\\\\\n\\[])+/[dgimsuvy]*","guard":"jsregex","rej":{"cls":"operator","n":1}},{"cls":"number","re":"0[xX][0-9a-fA-F][0-9a-fA-F_]*n?|0[bB][01][01_]*n?|0[oO][0-7][0-7_]*n?|(?:\\d[\\d_]*(?:\\.[\\d_]*)?|\\.\\d[\\d_]*)(?:[eE][+-]?\\d+)?n?"},{"cls":"keyword","re":"\\b(?:instanceof|implements|undefined|interface|namespace|protected|satisfies|function|continue|debugger|abstract|readonly|override|default|extends|finally|declare|private|asserts|return|switch|de\u006cete|typeof|\u0069mport|\u0065xport|static|public|module|\u0063onst|while|break|false|class|super|async|await|yield|catch|throw|keyof|infer|else|case|this|null|true|from|void|with|enum|var|\u006cet|for|new|try|if|do|in|of|as)\\b"},{"cls":"type","re":"\\b(?:globalThis|arguments|document|Infinity|console|boolean|unknown|window|string|number|object|symbol|bigint|never|NaN|any)\\b"},{"cls":"function","re":"[A-Za-z_$][\\w$]*(?=\\s*\\()"},{"cls":"type","re":"[A-Z][\\w$]*"},{"cls":"plain","re":"[A-Za-z_$][\\w$]*"},{"cls":"operator","re":"=\u003e|\\.\\.\\.|\\?\\?=?|\\?\\.(?!\\d)|===|!==|==|!=|\u003c\u003c=|\u003e\u003e\u003e=|\u003e\u003e=|\u003e\u003e\u003e|\u003c\u003c|\u003e\u003e|\u003c=|\u003e=|&&=|\\|\\|=|\\*\\*=|\\*\\*|\\+\\+|--|[+\\-*/%&|^]=|&&|\\|\\||=|[+\\-*/%\u003c\u003e!~&|^?:]"},{"cls":"punctuation","re":"[{}()\\[\\];,.]"}]},"python":{"flags":"","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"comment","re":"#[^\\n]*"},{"cls":"string","re":"[rRbBuUfF]{0,3}\"\"\"[\\s\\S]*?(?:\"\"\"|$)"},{"cls":"string","re":"[rRbBuUfF]{0,3}'''[\\s\\S]*?(?:'''|$)"},{"cls":"string","re":"[rRbBuUfF]{0,3}\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*(?:\"|(?=\\n)|$)"},{"cls":"string","re":"[rRbBuUfF]{0,3}'(?:\\\\[\\s\\S]|[^'\\\\\\n])*(?:'|(?=\\n)|$)"},{"cls":"function","re":"@[A-Za-z_][\\w.]*"},{"cls":"number","re":"0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\\d[\\d_]*(?:\\.[\\d_]*)?|\\.\\d[\\d_]*)(?:[eE][+-]?\\d+)?[jJ]?"},{"cls":"keyword","re":"\\b(?:nonlocal|continue|finally|return|\u0069mport|except|lambda|global|assert|class|while|raise|yield|break|False|async|await|elif|else|from|with|pass|None|True|def|for|try|and|not|del|if|as|or|in|is)\\b"},{"cls":"type","re":"\\b(?:bytearray|frozenset|complex|object|float|tuple|bytes|bool|list|dict|self|int|str|set|cls)\\b"},{"cls":"function","re":"[A-Za-z_]\\w*(?=\\s*\\()"},{"cls":"type","re":"[A-Z]\\w*"},{"cls":"plain","re":"[A-Za-z_]\\w*"},{"cls":"operator","re":"\\*\\*=?|//=?|==|!=|\u003c=|\u003e=|\u003c\u003c=?|\u003e\u003e=?|-\u003e|:=|[+\\-*/%@&|^]=|[+\\-*/%\u003c\u003e=!~&|^]"},{"cls":"punctuation","re":"[{}()\\[\\];,.:]"}]},"json":{"flags":"","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"comment","re":"//[^\\n]*"},{"cls":"comment","re":"/\\*[\\s\\S]*?(?:\\*/|$)"},{"cls":"type","re":"\"(?:\\\\[\\s\\S]|[^\"\\\\])*\"(?=\\s*:)"},{"cls":"string","re":"\"(?:\\\\[\\s\\S]|[^\"\\\\])*(?:\"|$)"},{"cls":"keyword","re":"\\b(?:false|true|null)\\b"},{"cls":"number","re":"-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"},{"cls":"punctuation","re":"[{}\\[\\],:]"},{"cls":"plain","re":"[^\\s{}\\[\\],:\"]+"}]},"sql":{"flags":"i","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"comment","re":"--[^\\n]*"},{"cls":"comment","re":"/\\*[\\s\\S]*?(?:\\*/|$)"},{"cls":"string","re":"'(?:''|\\\\[\\s\\S]|[^'\\\\])*(?:'|$)"},{"cls":"type","re":"\"(?:\"\"|[^\"])*(?:\"|$)"},{"cls":"type","re":"\\u0060[^\\u0060]*(?:\\u0060|$)"},{"cls":"type","re":"\\[[^\\]\\n]*(?:\\]|$)"},{"cls":"keyword","re":"\\b(?:references|\u0063onstraint|intersect|recursive|returning|distinct|rollback|between|primary|foreign|default|select|having|offset|insert|values|update|de\u006cete|create|exists|except|unique|commit|revoke|where|group|order|limit|alter|table|index|inner|right|outer|cross|using|ilike|union|check|begin|grant|false|from|into|drop|view|join|left|full|null|like|case|when|then|else|with|desc|true|set|and|not|end|all|key|asc|by|on|as|or|is|in)\\b"},{"cls":"type","re":"\\b(?:timestamp|smallint|datetime|interval|integer|decimal|numeric|varchar|boolean|bigint|double|serial|float|jsonb|bytea|real|char|text|date|time|bool|blob|json|uuid|int)\\b"},{"cls":"function","re":"[A-Za-z_][\\w$]*(?=\\s*\\()"},{"cls":"number","re":"\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"},{"cls":"operator","re":"\u003c\u003e|!=|\u003c=|\u003e=|\\|\\||::|[-+*/%\u003c\u003e=]"},{"cls":"type","re":"[:@$]\\w+"},{"cls":"punctuation","re":"[(),;.]"},{"cls":"plain","re":"[A-Za-z_][\\w$]*"}]},"shell":{"flags":"","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"type","re":"\\$\\{[^}\\n]*\\}"},{"cls":"punctuation","re":"\\$\\(\\(?"},{"cls":"type","re":"\\$[A-Za-z_]\\w*"},{"cls":"type","re":"\\$[0-9@*#?$!_-]"},{"cls":"comment","re":"(?\u003c![^\\s;|&(])#[^\\n]*"},{"cls":"string","re":"\\$?\"(?:\\\\[\\s\\S]|[^\"\\\\])*(?:\"|$)"},{"cls":"string","re":"\\$?'[^']*(?:'|$)"},{"cls":"keyword","re":"\\b(?:function|continue|readonly|declare|select|return|\u0065xport|source|while|until|break|local|unset|shift|then|else|elif|done|case|esac|eval|exec|trap|for|set|if|fi|do|in)\\b"},{"cls":"type","re":"[A-Za-z_]\\w*(?==[^=])"},{"cls":"operator","re":"(?\u003c=\\s)--?[A-Za-z][\\w-]*"},{"cls":"function","re":"[A-Za-z_][\\w.+-]*(?:/[\\w.+-]+)*","guard":"shcmd","rej":{"cls":"plain","n":0}},{"cls":"number","re":"\\d+"},{"cls":"operator","re":"&&|\\|\\||\u003e\u003e|\u003c\u003c|[|&;\u003c\u003e=!]"},{"cls":"punctuation","re":"[(){}\\[\\],]"}]},"css":{"flags":"","rules":[{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"comment","re":"/\\*[\\s\\S]*?(?:\\*/|$)"},{"cls":"string","re":"\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*(?:\"|$)"},{"cls":"string","re":"'(?:\\\\[\\s\\S]|[^'\\\\\\n])*(?:'|$)"},{"cls":"keyword","re":"@[-\\w]+"},{"cls":"keyword","re":"!\\s*\u0069mportant\\b"},{"cls":"type","re":"--[-\\w]+"},{"cls":"number","re":"#[0-9a-fA-F]{3,8}\\b"},{"cls":"function","re":"[-\\w]+(?=\\()"},{"cls":"function","re":"::?[a-zA-Z][-\\w]*"},{"cls":"type","re":"[.#][-\\w]+"},{"cls":"keyword","re":"[-a-zA-Z][-\\w]*(?=\\s*:)"},{"cls":"number","re":"-?(?:\\d+\\.?\\d*|\\.\\d+)(?:%|[a-zA-Z]{1,4})?"},{"cls":"plain","re":"[-a-zA-Z_][-\\w]*"},{"cls":"operator","re":"[\u003e~+*/=|^$]"},{"cls":"punctuation","re":"[{}()\\[\\];:,.]"}]},"html":{"flags":"","rules":[{"cls":"comment","re":"\u003c!--[\\s\\S]*?(?:--\u003e|$)"},{"cls":"string","re":"\u003c!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]\u003e|$)"},{"cls":"keyword","re":"\u003c![A-Za-z][^\u003e]*(?:\u003e|$)"},{"cls":"keyword","re":"\u003c/?[A-Za-z][\\w:.-]*"},{"cls":"string","re":"\"[^\"]*(?:\"|$)"},{"cls":"string","re":"'[^']*(?:'|$)"},{"cls":"type","re":"[A-Za-z_:][\\w:.-]*(?=\\s*=)"},{"cls":"number","re":"&(?:#\\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);"},{"cls":"operator","re":"="},{"cls":"punctuation","re":"/?\u003e"},{"cls":"plain","re":"[ \\t\\n]+"},{"cls":"plain","re":"[^\u003c&\\s=/\"']+"}]}};
  var CK_CODE_NAMES = ["plain","javascript","typescript","python","json","sql","shell","css","html"];
  var CK_CODE_ALIAS = ["js","javascript","mjs","javascript","cjs","javascript","jsx","javascript","node","javascript","ts","typescript","tsx","typescript","py","python","python3","python","sh","shell","bash","shell","zsh","shell","console","shell","shellsession","shell","postgres","sql","postgresql","sql","mysql","sql","sqlite","sql","jsonc","json","json5","json","scss","css","htm","html","xml","html","svg","html","vue","html","text","plain","txt","plain","none","plain"];
  var CK_CODE_CLASSES = ["comment","string","number","keyword","type","function","operator","punctuation","plain"];
  var CK_CODE_TICK = String.fromCharCode(96);
  var CK_CODE_CACHE = {};

function ckCodeEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ckCodeLangName(raw) {
  var k = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9+#]/g, ''), i;
  for (i = 0; i < CK_CODE_NAMES.length; i++) if (CK_CODE_NAMES[i] === k) return k;
  for (i = 0; i < CK_CODE_ALIAS.length; i += 2) if (CK_CODE_ALIAS[i] === k) return CK_CODE_ALIAS[i + 1];
  return 'plain';
}

function ckCodeGroups(src) {
  return new RegExp(src + '|').exec('').length - 1;
}

function ckCodeCompile(name) {
  var hit = CK_CODE_CACHE['@' + name];
  if (hit) return hit;
  var lang = CK_CODE_LANGS[name] || CK_CODE_LANGS.plain;
  var rules = lang.rules, parts = [], offs = [], at = 1, i;
  for (i = 0; i < rules.length; i++) {
    parts.push('(' + rules[i].re + ')');
    offs.push(at);
    at += 1 + ckCodeGroups(rules[i].re);
  }
  hit = { re: new RegExp(parts.join('|'), 'y' + (lang.flags || '')), offs: offs, rules: rules };
  CK_CODE_CACHE['@' + name] = hit;
  return hit;
}

function ckCodeMatchBrace(text, open) {
  var d = 0, i = open, ch, q;
  while (i < text.length) {
    ch = text.charAt(i);
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === CK_CODE_TICK) {
      q = ch;
      i++;
      while (i < text.length) {
        if (text.charAt(i) === '\\') { i += 2; continue; }
        if (text.charAt(i) === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return i; }
    i++;
  }
  return -1;
}

function ckCodeScanTemplate(text, start) {
  var i = start + 1, ch, end;
  while (i < text.length) {
    ch = text.charAt(i);
    if (ch === '\\') { i += 2; continue; }
    if (ch === CK_CODE_TICK) return i + 1;
    if (ch === '$' && text.charAt(i + 1) === '{') {
      end = ckCodeMatchBrace(text, i + 1);
      if (end < 0) return text.length;
      i = end + 1;
      continue;
    }
    i++;
  }
  return text.length;
}

function ckCodeSplitTemplate(text, name, depth) {
  var out = [], i = 0, from = 0, end, inner, sub, k;
  while (i < text.length) {
    if (text.charAt(i) === '\\') { i += 2; continue; }
    if (text.charAt(i) === '$' && text.charAt(i + 1) === '{') {
      end = ckCodeMatchBrace(text, i + 1);
      if (end < 0) break;
      if (i > from) out.push({ cls: 'string', text: text.slice(from, i) });
      out.push({ cls: 'punctuation', text: '${' });
      inner = text.slice(i + 2, end);
      if (depth >= 3) {
        if (inner !== '') out.push({ cls: 'plain', text: inner });
      } else {
        sub = ckCodeLex(inner, name, depth + 1);
        for (k = 0; k < sub.length; k++) out.push(sub[k]);
      }
      out.push({ cls: 'punctuation', text: '}' });
      i = end + 1;
      from = i;
      continue;
    }
    i++;
  }
  if (from < text.length) out.push({ cls: 'string', text: text.slice(from) });
  return out;
}

function ckCodeGuardJsRegex(prev) {
  if (!prev) return true;
  if (prev.cls === 'number' || prev.cls === 'string' || prev.cls === 'type') return false;
  if (prev.cls === 'function') return false;
  if (prev.cls === 'plain') return !/[\w$]$/.test(prev.text);
  if (prev.cls === 'punctuation') return !/[)\]]$/.test(prev.text);
  if (prev.cls === 'keyword') return prev.text !== 'this';
  return true;
}

function ckCodeGuardShCommand(prev, atLine) {
  if (atLine || !prev) return true;
  if (prev.cls === 'operator' || prev.cls === 'punctuation') return /[|;&(){}!]$/.test(prev.text);
  if (prev.cls === 'keyword') return /^(?:do|then|else|elif|if|while|until)$/.test(prev.text);
  return false;
}

function ckCodeLex(src, name, depth) {
  var text = String(src == null ? '' : src);
  var c = ckCodeCompile(name);
  var out = [], pos = 0, pend = '', prev = null, atLine = true;
  var lim = text.length;
  var m, r, k, rule, cls, chunk, kept, g, end, pieces, p;

  while (pos < lim) {
    c.re.lastIndex = pos;
    m = c.re.exec(text);
    r = -1;
    if (m) {
      for (k = 0; k < c.offs.length; k++) {
        if (m[c.offs[k]] !== undefined) { r = k; break; }
      }
    }
    rule = r < 0 ? null : c.rules[r];

    if (!rule || m[0] === '') {
      /* No rule owns this byte. Gather it rather than emitting a token per character, so a
         language with gaps in its rules still produces readable runs. */
      pend += text.charAt(pos);
      pos++;
      continue;
    }

    chunk = m[0];
    cls = rule.cls;
    kept = true;
    if (rule.guard) {
      g = CK_CODE_GUARDS[rule.guard];
      if (g && !g(prev, atLine)) {
        kept = false;
        cls = rule.rej ? rule.rej.cls : 'plain';
        if (rule.rej && rule.rej.n > 0) chunk = chunk.slice(0, rule.rej.n);
      }
    }
    if (kept && rule.scan) {
      end = CK_CODE_SCANS[rule.scan](text, pos);
      if (end <= pos) end = pos + 1;
      chunk = text.slice(pos, end);
    }

    if (pend !== '') { out.push({ cls: 'plain', text: pend }); pend = ''; }

    if (kept && rule.split) {
      pieces = CK_CODE_SPLITS[rule.split](chunk, name, depth ? depth : 0);
      for (p = 0; p < pieces.length; p++) out.push(pieces[p]);
    } else {
      out.push({ cls: cls, text: chunk });
    }

    /* Whitespace and comments are transparent to the guards: what matters to a slash is the
       last thing that was a value, not the comment that happened to sit between them.
       NOTE: comments inside these functions travel into the emitted script, so they are
       written without backticks — a backtick there would be a template literal to the audit. */
    if (/\S/.test(chunk) && cls !== 'comment') prev = { cls: cls, text: chunk };
    if (chunk.indexOf('\n') >= 0) atLine = /\n[ \t]*$/.test(chunk);
    else if (atLine) atLine = /^[ \t]*$/.test(chunk);
    pos += chunk.length;
  }

  if (pend !== '') out.push({ cls: 'plain', text: pend });
  return out;
}

function ckCodeLines(tokens) {
  var lines = [[]], i, k, parts, t;
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    parts = t.text.split('\n');
    for (k = 0; k < parts.length; k++) {
      if (k > 0) lines.push([]);
      if (parts[k] !== '') lines[lines.length - 1].push({ cls: t.cls, text: parts[k] });
    }
  }
  return lines;
}

function ckCodeRender(lines, start, hi) {
  var out = [], i, n, row, k, q, t, cls;
  for (i = 0; i < lines.length; i++) {
    n = start + i;
    out.push('<span class="ck-code-row' + (hi && hi['@' + n] ? ' is-hi' : '') + '">');
    out.push('<span class="ck-code-num" aria-hidden="true">' + n + '</span>');
    out.push('<span class="ck-code-txt">');
    row = lines[i];
    for (k = 0; k < row.length; k++) {
      t = row[k];
      cls = 'plain';
      for (q = 0; q < CK_CODE_CLASSES.length; q++) {
        if (CK_CODE_CLASSES[q] === t.cls) { cls = t.cls; break; }
      }
      out.push('<span class="ck-t-' + cls + '">' + ckCodeEsc(t.text) + '</span>');
    }
    out.push('</span></span>');
  }
  return out.join('');
}

function ckCodeCaption(lang, lines, marked) {
  var s = '<b>' + ckCodeEsc(lang) + '</b> <i>' + lines + (lines === 1 ? ' line' : ' lines') + '</i>';
  if (marked > 0) s += ' <span class="ck-aside">' + marked + ' emphasised</span>';
  return s;
}

  var CK_CODE_GUARDS = { jsregex: ckCodeGuardJsRegex, shcmd: ckCodeGuardShCommand };
  var CK_CODE_SCANS = { template: ckCodeScanTemplate };
  var CK_CODE_SPLITS = { template: ckCodeSplitTemplate };

  var DEFAULTS = {"lang":"javascript","numbers":true,"wrap":false};
  /* The raw snippet travels with the card for two reasons: the copy button hands over the
     source rather than a scrape of the DOM, and changing the language re-lexes from this
     instead of trying to reconstruct it from the spans. */
  var RAW = "/**\n * A repeating timer that survives a \u0060\u003cmain\u003e\u0060 swap without ever running twice.\n *\n * \u0060once\u0060 cannot do this job and it is worth saying why, because the gap is invisible\n * until it bites: \u0060once\u0060 keys off the ELEMENT, and a swap hands the builder a brand\n * new element with an empty dataset — so the guard passes, a second interval\n * starts, and the old one is still running against a detached node. The symptom is a\n * card that fetches twice an hour, then four times, then eight, and nothing in the\n * code looks wrong.\n *\n * Keyed by name in a registry that outlives the DOM, so the swap replaces rather\n * than stacks. Found by the clock/weather build, which hit exactly this.\n *\n * @param name a stable key, conventionally the card’s id plus the job\n * @param ms   the interval; the callback also fires once immediately\n * @param fn   the work\n * @returns a stop function\n *\n * @example CK.timer(\"weather:poll\", 60000, refresh);\n */\nfunction timer(name, ms, fn) {\n  window.__ckTimers = window.__ckTimers || {};\n  clearInterval(window.__ckTimers[name]);\n  fn();\n  window.__ckTimers[name] = setInterval(fn, ms);\n  return function () { clearInterval(window.__ckTimers[name]); };\n}";
  var HI = {"@189":1,"@190":1,"@191":1,"@192":1,"@193":1,"@194":1,"@195":1};
  var START = 170;
  var COUNT = 27;
  var MARKED = 7;

  CK.build("code", function (sec) {

    var body = sec.querySelector(".ck-code-body"),
        chip = sec.querySelector(".ck-code-chip"),
        cap  = sec.querySelector(".ck-cap"),
        btn  = sec.querySelector(".ck-code-copy"),
        msg  = sec.querySelector(".ck-code-msg");

    /* What the server already painted. Starting here means the common case — settings
       untouched, or touched only for wrap and numbers — never re-lexes at all. */
    var shown = DEFAULTS.lang;
    var timer = 0;

    /**
     * Say what just happened, beside the button, and colour the button to match.
     * A failure lingers longer than a success because it asks the viewer to do something.
     */
    function say(text, state) {
      if (msg) { msg.textContent = text; msg.setAttribute("data-state", state); }
      if (btn) btn.setAttribute("data-state", state);
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (msg) { msg.textContent = ""; msg.removeAttribute("data-state"); }
        if (btn) btn.removeAttribute("data-state");
      }, state === "fail" ? 5000 : 1600);
    }

    /**
     * The pre-clipboard-API copy: a hidden textarea, selected, and execCommand.
     * Still needed on any page that is not a secure context, where navigator.clipboard
     * simply is not there.
     */
    function legacyCopy() {
      var ta = document.createElement("textarea"), okd = false;
      ta.value = RAW;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      try {
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        okd = !!document.execCommand("copy");
      } catch (e) { okd = false; }
      document.body.removeChild(ta);
      return okd;
    }

    /* Every path ends in a visible statement. A permissions prompt the viewer dismissed,
       a non-secure context, an engine with neither route — all of them say so, and the
       last one says what to do instead. */
    function copy() {
      var ok = function () { say("copied", "ok"); };
      var no = function () {
        if (legacyCopy()) ok();
        else say("copy blocked \u2014 select the code and press Ctrl+C", "fail");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { navigator.clipboard.writeText(RAW).then(ok, no); }
        catch (e) { no(); }
      } else { no(); }
    }

    if (btn) CK.once(btn, "codecopy", function () {
      btn.addEventListener("click", function () { copy(); });
    });

    /** Reflect the settled settings. Only a language change costs a re-lex. */
    function apply(cfg) {
      sec.setAttribute("data-wrap", cfg.wrap ? "on" : "off");
      sec.setAttribute("data-numbers", cfg.numbers ? "on" : "off");

      var want = ckCodeLangName(cfg.lang);
      if (want === shown || !body) return;
      shown = want;
      body.innerHTML = ckCodeRender(ckCodeLines(ckCodeLex(RAW, want, 0)), START, HI);
      if (chip) chip.textContent = want;
      if (cap) cap.innerHTML = ckCodeCaption(want, COUNT, MARKED);
    }

    CK.settings(sec, DEFAULTS, apply);
  });
})();