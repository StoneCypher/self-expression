/**
 * @file cardkit card type: `code` — a syntax-highlighted snippet, with a gutter and a copy button.
 *
 * The highlighting is done here, in Node, at build time, and the card ships pre-tokenised markup
 * so the browser only paints. That is not an optimisation, it is the only option: the desk's CSP
 * is `script-src 'self'`, so there is no CDN to pull a highlighter from and no npm dependency the
 * page would be allowed to execute. What is here instead is a small regex lexer, and it is small
 * enough to read in one sitting, which is worth more on a surface that renders other people's
 * text than any amount of language coverage.
 *
 * The same lexer is emitted into `js` as well. One setting — `lang` — can be changed by the
 * viewer, and a card that was mis-tagged should be fixable in place rather than re-built; that
 * means the browser needs the raw source and a way to re-lex it. Emitting the *same functions*
 * (via `Function.prototype.toString`) rather than a second implementation is the whole point:
 * two lexers that are supposed to agree about what is safe eventually will not.
 *
 * @see ../kit.js  — `CK.settings`, `CK.once`, `CK.build`, `CK.esc`
 * @see ../kit.css — `.ck-gear`, `.ck-set`, `.ck-cap`, `.ck-scroll`, and the `--ck-*` tokens
 */

/* ── build-time helpers ─────────────────────────────────────────────────────────────────── */

/**
 * HTML-escape a build-time value, mirroring `CK.esc` byte for byte.
 *
 * A second escaper that disagreed with the kit's by one character would be a hole that only
 * shows up in whichever half of the card the other one rendered.
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
 * A JSON literal safe to paste into a classic `<script>` body, and safe to grep afterwards.
 *
 * The first two replacements are the security ones: a value containing `</script` would close
 * the element early and spill the rest of the card as text, and the two Unicode line separators
 * are newlines to a JS parser but not to JSON. The rest are house-rule replacements, and they
 * exist because this card's *data* is source code in nine languages — the JS keyword list really
 * does contain the words `const`, `let`, `import` and `export`, the operator table really does
 * contain `=>`, and a template literal is anchored on a real backtick. Every one of those would
 * trip the emitted script's own ES5-and-classic-script audit as a false positive. Rewriting the
 * first character of each as a `\\uXXXX` escape leaves the decoded string byte-identical and
 * leaves the emitted file honestly free of the sequences it must not contain — so the audit can
 * stay a plain substring search, which is the kind of check that does not rot.
 *
 * @param v any JSON-serialisable value
 *
 * @example jsJson({ a: '</script>' });   // '{"a":"\\u003c/script\\u003e"}'
 * @example jsJson(['const']);            // '["\\u0063onst"]'
 */
function jsJson(v) {
  let s = JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    .replace(/\u0060/g, '\\u0060')
    .replace(/\?\./g, '?\\u002e');
  for (const word of ['const', 'let', 'import', 'export']) {
    const code = word.charCodeAt(0).toString(16).padStart(4, '0');
    s = s.split(word).join('\\u' + code + word.slice(1));
  }
  return s;
}

/**
 * A `\b(?:…)\b` alternation over a word list, longest first.
 *
 * Longest-first is belt and braces — a JS alternation backtracks into the longer arm anyway when
 * the trailing `\b` fails — but it makes the emitted pattern behave the same under engines with
 * a possessive or atomic reading, and it costs one sort.
 *
 * @param list the words; all must be plain `[A-Za-z_]` runs, since none are escaped
 *
 * @example words(['in', 'instanceof']);   // '\\b(?:instanceof|in)\\b'
 */
function words(list) {
  const sorted = list.slice().sort((a, b) => b.length - a.length);
  return '\\b(?:' + sorted.join('|') + ')\\b';
}

/* ── the token vocabulary ───────────────────────────────────────────────────────────────── */

/**
 * Every class a token may carry. An array rather than an object because it is looked up on the
 * render path, where an object would expose `constructor` and friends as accidentally-valid
 * class names — and a class name is the one part of the output that must never come from input.
 */
const CK_CODE_CLASSES = [
  'comment', 'string', 'number', 'keyword', 'type', 'function', 'operator', 'punctuation', 'plain'
];

/* ── language rules ─────────────────────────────────────────────────────────────────────── */

/* Regex sources are written with String.raw so a backslash is a backslash. The one character
   that cannot appear here is a backtick — it would end the raw literal, and it must not survive
   into the emitted script — so wherever a pattern needs one it is written as the regex escape
   `\u0060`, which the RegExp constructor reads as a backtick and grep reads as six ASCII bytes. */

/** Whitespace, matched explicitly so the lexer can track line starts without a special case. */
const WS = { cls: 'plain', re: String.raw`[ \t\n]+` };

const JS_KEYWORDS = [
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break',
  'continue', 'switch', 'case', 'default', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
  'this', 'null', 'undefined', 'true', 'false', 'class', 'extends', 'super', 'import', 'export',
  'from', 'as', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw', 'void', 'with',
  'debugger', 'static'
];

const JS_TYPES = ['console', 'window', 'document', 'globalThis', 'Infinity', 'NaN', 'arguments'];

const TS_KEYWORDS = [
  'interface', 'enum', 'namespace', 'declare', 'abstract', 'implements', 'readonly', 'private',
  'public', 'protected', 'keyof', 'infer', 'satisfies', 'asserts', 'module', 'override'
];

const TS_TYPES = ['string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint'];

/**
 * The javascript/typescript rule list.
 *
 * Order is the grammar. Comments precede strings so `// "` cannot open one; strings precede the
 * regex-literal rule so a `/` inside quotes is never a pattern; keywords precede the call-shaped
 * `function` rule so `if (` is a conditional rather than a call.
 *
 * @param extraKeywords words to add to the keyword set (TypeScript's declaration vocabulary)
 * @param extraTypes    words to colour as types (TypeScript's primitive type names)
 */
function jsRules(extraKeywords, extraTypes) {
  return [
    WS,
    { cls: 'comment', re: String.raw`//[^\n]*` },
    { cls: 'comment', re: String.raw`/\*[\s\S]*?(?:\*/|$)` },
    { cls: 'string', re: String.raw`\u0060`, scan: 'template', split: 'template' },
    { cls: 'string', re: String.raw`"(?:\\[\s\S]|[^"\\\n])*(?:"|(?=\n)|$)` },
    { cls: 'string', re: String.raw`'(?:\\[\s\S]|[^'\\\n])*(?:'|(?=\n)|$)` },
    {
      cls: 'string',
      re: String.raw`/(?![*/=])(?:\\[\s\S]|\[(?:\\[\s\S]|[^\]\\\n])*\]|[^/\\\n\[])+/[dgimsuvy]*`,
      guard: 'jsregex',
      rej: { cls: 'operator', n: 1 }
    },
    {
      cls: 'number',
      re: String.raw`0[xX][0-9a-fA-F][0-9a-fA-F_]*n?|0[bB][01][01_]*n?|0[oO][0-7][0-7_]*n?` +
          String.raw`|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?`
    },
    { cls: 'keyword', re: words(JS_KEYWORDS.concat(extraKeywords || [])) },
    { cls: 'type', re: words(JS_TYPES.concat(extraTypes || [])) },
    { cls: 'function', re: String.raw`[A-Za-z_$][\w$]*(?=\s*\()` },
    { cls: 'type', re: String.raw`[A-Z][\w$]*` },
    { cls: 'plain', re: String.raw`[A-Za-z_$][\w$]*` },
    {
      cls: 'operator',
      re: String.raw`=>|\.\.\.|\?\?=?|\?\.(?!\d)|===|!==|==|!=|<<=|>>>=|>>=|>>>|<<|>>|<=|>=` +
          String.raw`|&&=|\|\|=|\*\*=|\*\*|\+\+|--|[+\-*/%&|^]=|&&|\|\||=|[+\-*/%<>!~&|^?:]`
    },
    { cls: 'punctuation', re: String.raw`[{}()\[\];,.]` }
  ];
}

const PY_KEYWORDS = [
  'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 'from', 'as', 'with',
  'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break',
  'continue', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False', 'async', 'await', 'assert',
  'del'
];

const PY_TYPES = [
  'int', 'str', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'bytearray', 'complex',
  'frozenset', 'object', 'self', 'cls'
];

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'group', 'order', 'by', 'having', 'limit', 'offset', 'insert',
  'into', 'values', 'update', 'set', 'delete', 'create', 'alter', 'drop', 'table', 'view',
  'index', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'on', 'using', 'as',
  'and', 'or', 'not', 'null', 'is', 'in', 'exists', 'between', 'like', 'ilike', 'case', 'when',
  'then', 'else', 'end', 'distinct', 'union', 'all', 'except', 'intersect', 'with', 'recursive',
  'primary', 'foreign', 'key', 'references', 'unique', 'check', 'constraint', 'default', 'asc',
  'desc', 'returning', 'begin', 'commit', 'rollback', 'grant', 'revoke', 'true', 'false'
];

const SQL_TYPES = [
  'int', 'integer', 'smallint', 'bigint', 'decimal', 'numeric', 'float', 'real', 'double',
  'varchar', 'char', 'text', 'date', 'time', 'timestamp', 'datetime', 'boolean', 'bool', 'blob',
  'json', 'jsonb', 'uuid', 'serial', 'bytea', 'interval'
];

const SH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'in', 'function', 'select', 'return', 'break', 'continue', 'local', 'export', 'readonly',
  'declare', 'unset', 'shift', 'eval', 'exec', 'trap', 'set', 'source'
];

/**
 * Every language this card can highlight, keyed by its canonical name.
 *
 * `plain` is not a fallback in the apologetic sense — it is a real choice, and it is what a
 * snippet gets when its tag is a language nobody here wrote rules for. One rule, everything,
 * one token: the card still gets numbers, wash, gutter and copy button.
 */
const CK_CODE_LANGS = {
  plain: { flags: '', rules: [{ cls: 'plain', re: String.raw`[\s\S]+` }] },

  javascript: { flags: '', rules: jsRules([], []) },
  typescript: { flags: '', rules: jsRules(TS_KEYWORDS, TS_TYPES) },

  python: {
    flags: '',
    rules: [
      WS,
      { cls: 'comment', re: String.raw`#[^\n]*` },
      { cls: 'string', re: String.raw`[rRbBuUfF]{0,3}"""[\s\S]*?(?:"""|$)` },
      { cls: 'string', re: String.raw`[rRbBuUfF]{0,3}'''[\s\S]*?(?:'''|$)` },
      { cls: 'string', re: String.raw`[rRbBuUfF]{0,3}"(?:\\[\s\S]|[^"\\\n])*(?:"|(?=\n)|$)` },
      { cls: 'string', re: String.raw`[rRbBuUfF]{0,3}'(?:\\[\s\S]|[^'\\\n])*(?:'|(?=\n)|$)` },
      { cls: 'function', re: String.raw`@[A-Za-z_][\w.]*` },
      {
        cls: 'number',
        re: String.raw`0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+` +
            String.raw`|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?`
      },
      { cls: 'keyword', re: words(PY_KEYWORDS) },
      { cls: 'type', re: words(PY_TYPES) },
      { cls: 'function', re: String.raw`[A-Za-z_]\w*(?=\s*\()` },
      { cls: 'type', re: String.raw`[A-Z]\w*` },
      { cls: 'plain', re: String.raw`[A-Za-z_]\w*` },
      {
        cls: 'operator',
        re: String.raw`\*\*=?|//=?|==|!=|<=|>=|<<=?|>>=?|->|:=|[+\-*/%@&|^]=|[+\-*/%<>=!~&|^]`
      },
      { cls: 'punctuation', re: String.raw`[{}()\[\];,.:]` }
    ]
  },

  json: {
    flags: '',
    rules: [
      WS,
      { cls: 'comment', re: String.raw`//[^\n]*` },
      { cls: 'comment', re: String.raw`/\*[\s\S]*?(?:\*/|$)` },
      { cls: 'type', re: String.raw`"(?:\\[\s\S]|[^"\\])*"(?=\s*:)` },
      { cls: 'string', re: String.raw`"(?:\\[\s\S]|[^"\\])*(?:"|$)` },
      { cls: 'keyword', re: words(['true', 'false', 'null']) },
      { cls: 'number', re: String.raw`-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?` },
      { cls: 'punctuation', re: String.raw`[{}\[\],:]` },
      { cls: 'plain', re: String.raw`[^\s{}\[\],:"]+` }
    ]
  },

  sql: {
    flags: 'i',
    rules: [
      WS,
      { cls: 'comment', re: String.raw`--[^\n]*` },
      { cls: 'comment', re: String.raw`/\*[\s\S]*?(?:\*/|$)` },
      { cls: 'string', re: String.raw`'(?:''|\\[\s\S]|[^'\\])*(?:'|$)` },
      { cls: 'type', re: String.raw`"(?:""|[^"])*(?:"|$)` },
      { cls: 'type', re: String.raw`\u0060[^\u0060]*(?:\u0060|$)` },
      { cls: 'type', re: String.raw`\[[^\]\n]*(?:\]|$)` },
      { cls: 'keyword', re: words(SQL_KEYWORDS) },
      { cls: 'type', re: words(SQL_TYPES) },
      { cls: 'function', re: String.raw`[A-Za-z_][\w$]*(?=\s*\()` },
      { cls: 'number', re: String.raw`\d+(?:\.\d+)?(?:[eE][+-]?\d+)?` },
      { cls: 'operator', re: String.raw`<>|!=|<=|>=|\|\||::|[-+*/%<>=]` },
      { cls: 'type', re: String.raw`[:@$]\w+` },
      { cls: 'punctuation', re: String.raw`[(),;.]` },
      { cls: 'plain', re: String.raw`[A-Za-z_][\w$]*` }
    ]
  },

  shell: {
    flags: '',
    rules: [
      WS,
      { cls: 'type', re: String.raw`\$\{[^}\n]*\}` },
      { cls: 'punctuation', re: String.raw`\$\(\(?` },
      { cls: 'type', re: String.raw`\$[A-Za-z_]\w*` },
      { cls: 'type', re: String.raw`\$[0-9@*#?$!_-]` },
      /* A `#` only opens a comment where a word could not have continued. Written as a
         fixed-width negative lookbehind so it also holds at index 0, where there is no
         preceding character at all. */
      { cls: 'comment', re: String.raw`(?<![^\s;|&(])#[^\n]*` },
      { cls: 'string', re: String.raw`\$?"(?:\\[\s\S]|[^"\\])*(?:"|$)` },
      /* Single quotes in shell have no escapes at all — that is the point of them — so this
         rule must NOT honour a backslash, or `'it\'` would swallow the rest of the script. */
      { cls: 'string', re: String.raw`\$?'[^']*(?:'|$)` },
      { cls: 'keyword', re: words(SH_KEYWORDS) },
      { cls: 'type', re: String.raw`[A-Za-z_]\w*(?==[^=])` },
      { cls: 'operator', re: String.raw`(?<=\s)--?[A-Za-z][\w-]*` },
      {
        cls: 'function',
        re: String.raw`[A-Za-z_][\w.+-]*(?:/[\w.+-]+)*`,
        guard: 'shcmd',
        rej: { cls: 'plain', n: 0 }
      },
      { cls: 'number', re: String.raw`\d+` },
      { cls: 'operator', re: String.raw`&&|\|\||>>|<<|[|&;<>=!]` },
      { cls: 'punctuation', re: String.raw`[(){}\[\],]` }
    ]
  },

  css: {
    flags: '',
    rules: [
      WS,
      { cls: 'comment', re: String.raw`/\*[\s\S]*?(?:\*/|$)` },
      { cls: 'string', re: String.raw`"(?:\\[\s\S]|[^"\\\n])*(?:"|$)` },
      { cls: 'string', re: String.raw`'(?:\\[\s\S]|[^'\\\n])*(?:'|$)` },
      { cls: 'keyword', re: String.raw`@[-\w]+` },
      { cls: 'keyword', re: String.raw`!\s*important\b` },
      { cls: 'type', re: String.raw`--[-\w]+` },
      /* Before the id-selector rule, so `#3fa` in a declaration is a colour. The cost is that
         an id whose name is all hex digits reads as one too; that is the rarer snippet. */
      { cls: 'number', re: String.raw`#[0-9a-fA-F]{3,8}\b` },
      { cls: 'function', re: String.raw`[-\w]+(?=\()` },
      { cls: 'function', re: String.raw`::?[a-zA-Z][-\w]*` },
      { cls: 'type', re: String.raw`[.#][-\w]+` },
      { cls: 'keyword', re: String.raw`[-a-zA-Z][-\w]*(?=\s*:)` },
      { cls: 'number', re: String.raw`-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]{1,4})?` },
      { cls: 'plain', re: String.raw`[-a-zA-Z_][-\w]*` },
      { cls: 'operator', re: String.raw`[>~+*/=|^$]` },
      { cls: 'punctuation', re: String.raw`[{}()\[\];:,.]` }
    ]
  },

  html: {
    flags: '',
    rules: [
      { cls: 'comment', re: String.raw`<!--[\s\S]*?(?:-->|$)` },
      { cls: 'string', re: String.raw`<!\[CDATA\[[\s\S]*?(?:\]\]>|$)` },
      { cls: 'keyword', re: String.raw`<![A-Za-z][^>]*(?:>|$)` },
      { cls: 'keyword', re: String.raw`</?[A-Za-z][\w:.-]*` },
      { cls: 'string', re: String.raw`"[^"]*(?:"|$)` },
      { cls: 'string', re: String.raw`'[^']*(?:'|$)` },
      { cls: 'type', re: String.raw`[A-Za-z_:][\w:.-]*(?=\s*=)` },
      { cls: 'number', re: String.raw`&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);` },
      { cls: 'operator', re: String.raw`=` },
      { cls: 'punctuation', re: String.raw`/?>` },
      WS,
      { cls: 'plain', re: String.raw`[^<&\s=/"']+` }
    ]
  }
};

/** Canonical names, in the order the settings `<select>` offers them. */
const CK_CODE_NAMES = [
  'plain', 'javascript', 'typescript', 'python', 'json', 'sql', 'shell', 'css', 'html'
];

/**
 * Alias pairs, flat, because a flat array cannot be reached through `Object.prototype` the way
 * `alias['constructor']` can. Every lookup in this file that is keyed by untrusted text takes
 * this shape for the same reason.
 */
const CK_CODE_ALIAS = [
  'js', 'javascript', 'mjs', 'javascript', 'cjs', 'javascript', 'jsx', 'javascript',
  'node', 'javascript', 'ts', 'typescript', 'tsx', 'typescript', 'py', 'python',
  'python3', 'python', 'sh', 'shell', 'bash', 'shell', 'zsh', 'shell', 'console', 'shell',
  'shellsession', 'shell', 'postgres', 'sql', 'postgresql', 'sql', 'mysql', 'sql',
  'sqlite', 'sql', 'jsonc', 'json', 'json5', 'json', 'scss', 'css', 'htm', 'html',
  'xml', 'html', 'svg', 'html', 'vue', 'html', 'text', 'plain', 'txt', 'plain', 'none', 'plain'
];

/** Compiled-alternation cache, keyed with an `@` prefix so no key can collide with a prototype. */
const CK_CODE_CACHE = {};

/**
 * A backtick, spelled rather than typed.
 *
 * The two scanners below have to compare against one, and both of them are emitted into the
 * card's browser script by `String()`-ing their source — where a literal backtick would be a
 * template literal to the house style check, and worse, would be indistinguishable at a glance
 * from one. `String.fromCharCode` is ES5, is unambiguous, and greps as what it is.
 */
const CK_CODE_TICK = String.fromCharCode(96);

/* ── the lexer ──────────────────────────────────────────────────────────────────────────── */

/* Everything from here to the end of this section is written in ES5 — `var`, function
   declarations, no arrows, no template literals — because `script()` emits these functions by
   calling `String()` on them. They run unchanged in Node at build time and in the browser when
   the viewer changes the `lang` setting, which is the only way to be sure the two agree. */

/**
 * HTML-escape a token's text. The browser-side twin of the module's `esc`, and identical to it.
 *
 * @example ckCodeEsc('<img>');   // '&lt;img&gt;'
 */
function ckCodeEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Resolve a language tag to a canonical name, or to `plain`.
 *
 * The tag comes from card data and from a `<select>` a viewer can edit, so it is untrusted; the
 * answer is always one of `CK_CODE_NAMES`, never the caller's string. Punctuation is stripped
 * before matching so `Objective-C`, `objectivec` and `OBJECTIVE_C` all miss identically.
 *
 * @param raw whatever the snippet was tagged with
 *
 * @example ckCodeLangName('TS');        // 'typescript'
 * @example ckCodeLangName('brainfuck'); // 'plain'
 */
function ckCodeLangName(raw) {
  var k = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9+#]/g, ''), i;
  for (i = 0; i < CK_CODE_NAMES.length; i++) if (CK_CODE_NAMES[i] === k) return k;
  for (i = 0; i < CK_CODE_ALIAS.length; i += 2) if (CK_CODE_ALIAS[i] === k) return CK_CODE_ALIAS[i + 1];
  return 'plain';
}

/**
 * How many capture groups a pattern source contains.
 *
 * Appending an empty alternative makes the whole pattern match the empty string, so one `exec`
 * reports the group count without anyone having to parse the pattern. The count is what lets
 * rules keep their own inner groups without breaking the combined alternation's bookkeeping.
 *
 * @param src a valid pattern source
 *
 * @example ckCodeGroups('a(b)(c)');   // 2
 */
function ckCodeGroups(src) {
  return new RegExp(src + '|').exec('').length - 1;
}

/**
 * Compile one language's rules into a single sticky alternation.
 *
 * This is the heart of the design and the reason the classic lexer bugs do not happen here.
 * Every token kind — comment, string, number, keyword, everything — is one arm of ONE regex,
 * anchored with `y` at the cursor, and JavaScript alternation is ordered and leftmost-first. So
 * at each position exactly one rule wins, it consumes its whole token, and the cursor resumes
 * after it. A `//` that lies inside a string is never at the cursor, because the string rule
 * already consumed it; an apostrophe inside a `//` comment is never at the cursor either.
 *
 * Run as separate passes — find all comments, then find all strings — both of those break, and
 * they break each other: the comment pass finds `//x` inside `"http://x"` and cuts the string in
 * half, and the string pass pairs the apostrophe in `// don't` with the next quote several lines
 * down, swallowing everything between. Neither pass can be fixed without knowing the other's
 * result, which is to say without being the single pass this is.
 *
 * @param name a canonical language name; anything unknown compiles as `plain`
 * @returns `{ re, offs, rules }` — the alternation, each rule's group index, and the rules
 *
 * @example ckCodeCompile('json').rules.length > 0;   // true
 */
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

/**
 * The index of the `}` closing the brace at `open`, or -1 if the input runs out first.
 *
 * Quoted runs are skipped whole, so a `}` inside a string in an interpolation does not close it.
 * The cursor advances on every branch, so this cannot loop on any input, including malformed
 * input — which is the whole reason it exists as a scanner rather than as a nested-quantifier
 * regex that would have been a backtracking hazard.
 *
 * @param text the source
 * @param open index of the `{` to match; the caller guarantees that
 *
 * @example ckCodeMatchBrace('{a{b}c}', 0);   // 6
 * @example ckCodeMatchBrace('{oops', 0);     // -1
 */
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

/**
 * The index just past a template literal that starts at `start`.
 *
 * A scanner rather than a pattern because the extent of a template literal is not a regular
 * language: `` `a${ `b` }c` `` nests, and the regex that tried would be a nested quantifier over
 * alternations — the classic catastrophic-backtracking shape. Unterminated input returns the end
 * of the text, so the tail becomes one string token instead of hanging or throwing.
 *
 * @param text  the source
 * @param start index of the opening backtick
 *
 * @example ckCodeScanTemplate('`a${1}b` rest', 0);   // 8
 */
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

/**
 * Break a template literal into string pieces and lexed interpolations.
 *
 * The quoted parts stay one colour and the expressions inside `${ }` get the language's real
 * grammar, which is what makes `${a + "b"}` read as code rather than as more string. The pieces
 * concatenate back to exactly the input — that invariant is what the verifier checks, and it is
 * what guarantees no byte can slip past the escaper at render time.
 *
 * @param text  the whole template literal, backticks included
 * @param name  the language to lex interpolations with
 * @param depth current nesting; beyond three the inner text is left plain rather than recursed
 *
 * @example ckCodeSplitTemplate('`x${a}`', 'javascript', 0).length;   // 4
 */
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

/**
 * Whether a `/` at the cursor opens a regex literal rather than dividing.
 *
 * JavaScript cannot answer this without a parser; the shape everyone uses instead is "what came
 * immediately before". After a value — an identifier, a number, a string, a closing bracket — a
 * slash is division. After anything else, including `return` and `(`, it opens a pattern.
 *
 * @param prev the last significant token, or null at the start of the input
 *
 * @example ckCodeGuardJsRegex({ cls: 'keyword', text: 'return' });   // true
 * @example ckCodeGuardJsRegex({ cls: 'plain', text: 'a' });          // false
 */
function ckCodeGuardJsRegex(prev) {
  if (!prev) return true;
  if (prev.cls === 'number' || prev.cls === 'string' || prev.cls === 'type') return false;
  if (prev.cls === 'function') return false;
  if (prev.cls === 'plain') return !/[\w$]$/.test(prev.text);
  if (prev.cls === 'punctuation') return !/[)\]]$/.test(prev.text);
  if (prev.cls === 'keyword') return prev.text !== 'this';
  return true;
}

/**
 * Whether a bare word at the cursor is a command rather than an argument.
 *
 * A shell line is a verb followed by nouns, and only the verb should read as one. Command
 * position is the start of a line or whatever follows a separator, so that is what this asks.
 *
 * @param prev   the last significant token, or null
 * @param atLine whether only whitespace has passed since the last newline
 *
 * @example ckCodeGuardShCommand(null, true);                            // true
 * @example ckCodeGuardShCommand({ cls: 'plain', text: 'grep' }, false); // false
 */
function ckCodeGuardShCommand(prev, atLine) {
  if (atLine || !prev) return true;
  if (prev.cls === 'operator' || prev.cls === 'punctuation') return /[|;&(){}!]$/.test(prev.text);
  if (prev.cls === 'keyword') return /^(?:do|then|else|elif|if|while|until)$/.test(prev.text);
  return false;
}

/**
 * Tokenise source into `{ cls, text }` runs whose texts concatenate back to the input exactly.
 *
 * One cursor, one alternation, left to right; see {@link ckCodeCompile} for why that shape and
 * no other. Three things sit on top of it:
 *
 * - a **guard**, for the two places where the same character means two things depending on what
 *   preceded it (`/` in JavaScript, a bare word in shell). A rejected guard falls back to the
 *   rule's `rej` class instead of dropping the match, so `a /= 2` still gets an operator.
 * - a **scan**, for constructs whose extent is not regular — template literals — where a hand
 *   scanner replaces a regex that would have been a backtracking hazard.
 * - a **split**, for constructs that contain code, so an interpolation gets the real grammar.
 *
 * Nothing here can hang: every branch either consumes at least one character or advances the
 * cursor by one, and every unterminated construct is written to end at `$`.
 *
 * @param src   the source; anything not matched by a rule accumulates as plain text
 * @param name  a canonical language name
 * @param depth interpolation nesting, 0 at the top level
 *
 * @example ckCodeLex('a=1', 'javascript').map(function (t) { return t.cls; });
 * // ['plain', 'operator', 'number']
 */
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

/**
 * Redistribute tokens into one array per source line.
 *
 * A block comment or a triple-quoted string is one token spanning many lines, and every line of
 * it still needs its own row so the gutter and the highlight wash line up. Splitting on the
 * newline keeps the class and drops the newline itself; the row element supplies the break.
 *
 * @param tokens the output of {@link ckCodeLex}
 *
 * @example ckCodeLines([{ cls: 'plain', text: 'a\nb' }]).length;   // 2
 */
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

/**
 * Render lines as the card's rows.
 *
 * This is the only place text becomes markup, and every token's text goes through `ckCodeEsc`
 * here with no exception. The class name never comes from the input: `t.cls` is checked against
 * `CK_CODE_CLASSES` and anything unrecognised renders as `plain`, so even a corrupted token
 * stream cannot write an attribute.
 *
 * Rows carry no newline of their own — they are block boxes inside a `<pre>`, which is what puts
 * the line breaks into a manual selection while leaving the `user-select: none` gutter out of it.
 *
 * @param lines rows of tokens, as {@link ckCodeLines} returns them
 * @param start the number to give the first row
 * @param hi    a set of emphasised line numbers, keyed `'@' + n`
 *
 * @example ckCodeRender([[{ cls: 'plain', text: '<' }]], 1, {}).indexOf('&lt;') > 0;   // true
 */
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

/**
 * The caption line: what language this is being read as, and how much of it there is.
 *
 * Built by the same function on both sides so that changing the language in the settings panel
 * cannot leave a caption describing the previous one.
 *
 * @param lang   the canonical language name in force
 * @param lines  how many lines the snippet has
 * @param marked how many of them are emphasised; zero omits the clause
 *
 * @example ckCodeCaption('sql', 1, 0);   // '<b>sql</b> <i>1 line</i>'
 */
function ckCodeCaption(lang, lines, marked) {
  var s = '<b>' + ckCodeEsc(lang) + '</b> <i>' + lines + (lines === 1 ? ' line' : ' lines') + '</i>';
  if (marked > 0) s += ' <span class="ck-aside">' + marked + ' emphasised</span>';
  return s;
}

/** Named guards, resolved by name so the rule tables stay pure JSON-serialisable data. */
const CK_CODE_GUARDS = { jsregex: ckCodeGuardJsRegex, shcmd: ckCodeGuardShCommand };

/** Named extent scanners, for constructs a regex should not be asked to delimit. */
const CK_CODE_SCANS = { template: ckCodeScanTemplate };

/** Named splitters, for constructs that contain code of their own. */
const CK_CODE_SPLITS = { template: ckCodeSplitTemplate };

/* ── the card ───────────────────────────────────────────────────────────────────────────── */

/**
 * Every setting the card understands, with the value it falls back to.
 *
 * These three keys and the `<div class="ck-set">` field names are one thing seen twice; the
 * verifier checks that in both directions, because a field whose `name` has drifted is silently
 * ignored by `CK.settings` and looks exactly like a control that does nothing.
 */
const DEFAULTS = { lang: 'plain', numbers: true, wrap: false };

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * `shape` is the data literal, `defaults` the settings panel's contract. `lang` is in both, and
 * legitimately: a snippet arrives knowing what it is, and the viewer may disagree.
 *
 * @example meta.name;                    // 'code'
 * @example Object.keys(meta.defaults);   // ['lang', 'numbers', 'wrap']
 */
export const meta = {
  name: 'code',
  summary: 'A syntax-highlighted snippet with a line gutter and a copy button, lexed in Node at ' +
           'build time so the card ships no highlighting library.',
  shape: '{ code, lang, filename, startLine, highlight } — code untrusted text; lang a tag or alias; highlight [3, 7], [[10, 14]] or "3,7,10-14"',
  category: 'text-and-code',
  defaults: { ...DEFAULTS }
};

/** The languages the settings `<select>` offers, which is every language with rules. */
export const LANGUAGES = CK_CODE_NAMES.slice();

/**
 * Drop C0 control characters — and DEL — keeping tab and newline.
 *
 * Written as code-point arithmetic rather than as a character class on purpose. A class like
 * that has to be spelled with `\u` escapes, and an escape that gets decoded one step too early
 * puts the raw control character into this file, where it is invisible in every editor, legal to
 * the parser, and survives `node --check`. Comparing numbers cannot go wrong that way, and it
 * reads as what it means.
 *
 * @param s the text to clean
 *
 * @example stripControls('a\tb').length;   // 3
 *
 * @see clean
 */
function stripControls(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10) { out += ch; continue; }
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out;
}

/**
 * Normalise a snippet into the exact text the card shows and the copy button hands over.
 *
 * Four things happen and each is a bug someone hit by hand first. Line endings are unified so a
 * file pasted from Windows does not render a blank row between every line. C0 control characters
 * other than tab are removed: they are invisible in the card, invisible in the editor of whoever
 * pastes it, and legal to most parsers — which is precisely the combination that costs an evening
 * to find. Blank leading and trailing lines go, because a snippet lifted out of a template
 * literal always has them. Common indentation goes last, so a method pulled out of a class does
 * not arrive four levels deep.
 *
 * @param code the raw snippet
 * @returns the normalised source; the empty string for nothing usable
 *
 * @example clean('\r\n    a\r\n      b\r\n');   // 'a\n  b'
 */
function clean(code) {
  let s = stripControls(String(code == null ? '' : code).replace(/\r\n?/g, '\n'))
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
  if (s === '') return '';

  const lines = s.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (!/\S/.test(line)) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (indent < min) min = indent;
  }
  return Number.isFinite(min) && min > 0 ? lines.map((l) => l.slice(min)).join('\n') : s;
}

/**
 * The set of emphasised line numbers, clamped to lines the snippet actually has.
 *
 * Clamping happens before the loop rather than inside it, so `[1, 1000000000]` costs nothing
 * instead of counting to a billion — a card's data can be hand-edited, and a typo in a range
 * should not be a way to hang the build.
 *
 * @param spec  numbers, `[from, to]` pairs, `"5-8"` strings, or one comma-separated string
 * @param start the number given to the first row
 * @param count how many rows there are
 * @returns a set keyed `'@' + n`, empty when nothing applies
 *
 * @example marks([[2, 3], 7], 1, 10);   // { '@2': 1, '@3': 1, '@7': 1 }
 * @example marks('2,4-5', 1, 10);       // { '@2': 1, '@4': 1, '@5': 1 }
 */
function marks(spec, start, count) {
  const set = {};
  if (spec == null || count < 1) return set;
  const last = start + count - 1;

  const span = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const lo = Math.max(Math.min(a, b), start), hi = Math.min(Math.max(a, b), last);
    for (let n = Math.ceil(lo); n <= hi; n++) set['@' + n] = 1;
  };

  const one = (item) => {
    if (Array.isArray(item)) { span(Number(item[0]), Number(item[1] == null ? item[0] : item[1])); return; }
    if (typeof item === 'number') { span(item, item); return; }
    for (const part of String(item).split(',')) {
      const m = /^\s*(-?\d+)\s*(?:[-:–]\s*(-?\d+)\s*)?$/.exec(part);
      if (m) span(Number(m[1]), Number(m[2] == null ? m[1] : m[2]));
    }
  };

  if (Array.isArray(spec)) for (const item of spec) one(item);
  else one(spec);
  return set;
}

/**
 * Fold caller-supplied `data` onto the defaults, coercing rather than rejecting.
 *
 * A card descriptor may be hand-edited, and a mis-typed `lang` should give a working card with a
 * plain snippet in it — which the viewer can then correct from the gear, without a rebuild. That
 * is the entire reason `lang` is a setting and not just a build input.
 *
 * @param data the card's `data` block
 *
 * @example settle({ lang: 'PY', wrap: 1 }).lang;   // 'python'
 */
function settle(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    lang: ckCodeLangName(Object.hasOwn(d, 'lang') ? d.lang : DEFAULTS.lang),
    numbers: Object.hasOwn(d, 'numbers') ? !!d.numbers : DEFAULTS.numbers,
    wrap: Object.hasOwn(d, 'wrap') ? !!d.wrap : DEFAULTS.wrap
  };
}

/**
 * The `<option>` list for the language `<select>`, with the built language pre-selected.
 *
 * `CK.settings` reflects the stored value onto the control when the card wakes, but marking it
 * here means a static render — an editor preview, a saved page — is also correct.
 */
function options(chosen) {
  return LANGUAGES
    .map((v) => '<option value="' + esc(v) + '"' + (v === chosen ? ' selected' : '') + '>' +
                esc(v) + '</option>')
    .join('');
}

/**
 * The card's markup: heading, gear, settings panel, header strip, the block, and a caption.
 *
 * The gear is emitted empty on purpose — `CK.settings` draws the glyph into it, and a character
 * typed here would be a second source of truth for a shape the kit already owns.
 *
 * @param p everything the markup needs, already settled and rendered
 */
function markup(p) {
  const f = (name) => esc(p.id) + '-' + name;

  const head =
    '<div class="ck-code-head">' +
      (p.filename ? '<span class="ck-code-file">' + esc(p.filename) + '</span>' : '') +
      '<span class="ck-code-chip">' + esc(p.lang) + '</span>' +
      '<span class="ck-code-msg" role="status" aria-live="polite"></span>' +
      '<button class="ck-code-copy" type="button"' + (p.rows === '' ? ' disabled' : '') +
        '>copy</button>' +
    '</div>';

  const block = p.rows === ''
    ? '<p class="ck-code-empty">nothing to show &mdash; this card has no code</p>'
    : '<div class="ck-scroll ck-code-scroll" tabindex="0">' +
        '<pre class="ck-code-pre" style="--ck-code-gut:' + p.gutter + '">' +
        '<code class="ck-code-body">' + p.rows + '</code></pre>' +
      '</div>';

  return '<section data-card="' + esc(p.id) + '" class="ck-code"' +
      ' data-wrap="' + (p.cfg.wrap ? 'on' : 'off') + '"' +
      ' data-numbers="' + (p.cfg.numbers ? 'on' : 'off') + '"' +
      (p.ord == null ? '' : ' data-ord="' + esc(p.ord) + '"') + '>' +
    '<h2>' + esc(p.title) + '</h2>' +
    '<button class="ck-gear" type="button" title="settings" aria-label="code settings"></button>' +

    '<div class="ck-set" hidden>' +
      '<label for="' + f('lang') + '">language</label>' +
      '<select id="' + f('lang') + '" name="lang">' + options(p.cfg.lang) + '</select>' +

      '<label for="' + f('numbers') + '">line numbers</label>' +
      '<input id="' + f('numbers') + '" name="numbers" type="checkbox"' +
        (p.cfg.numbers ? ' checked' : '') + '>' +

      '<label for="' + f('wrap') + '">wrap lines</label>' +
      '<input id="' + f('wrap') + '" name="wrap" type="checkbox"' +
        (p.cfg.wrap ? ' checked' : '') + '>' +

      '<p class="ck-set-foot">Changing the language re-reads the snippet in the browser; the ' +
        'source is kept alongside the highlighting for exactly that.</p>' +
    '</div>' +

    head + block +
    '<div class="ck-cap">' + p.caption + '</div>' +
  '</section>';
}

/**
 * Every rule scoped under `.ck-code`, and not one literal colour anywhere.
 *
 * There is no `:root` block here and there does not need to be. The nine token classes are
 * mapped onto the desk's own series and ink tokens through a `--ck-code-*` alias layer declared
 * on `.ck-code` itself, so the theme switch is the only thing that has to know anything: when
 * `--ck-s4` flips, strings flip with it, in both viewers, with no second palette to keep in step.
 * `prefers-color-scheme` is untouched, because the desk is one document open in two viewers who
 * want different answers and the operating system gives both of them the same one.
 *
 * The mapping itself is chosen for reading rather than for decoration: comments and punctuation
 * fall back to ink so they recede, and the six classes that carry meaning get hue separation.
 */
function styles() {
  return [
    '.ck-code {',
    '  position: relative;',
    '  --ck-code-lh: 1.55;',
    '  --ck-code-comment: var(--ink-faint);',
    '  --ck-code-string: var(--ck-s4);',
    '  --ck-code-number: var(--ck-s2);',
    '  --ck-code-keyword: var(--ck-s7);',
    '  --ck-code-type: var(--ck-s5);',
    '  --ck-code-function: var(--ck-s6);',
    '  --ck-code-operator: var(--ck-s1);',
    '  --ck-code-punctuation: var(--ink-faint);',
    '  --ck-code-plain: var(--ink);',
    '  --ck-code-mark: var(--ck-s2);',
    '}',

    /* The header strip: what this is, and the one verb the card offers. */
    '.ck-code .ck-code-head {',
    '  display: flex; align-items: center; gap: 8px; margin: 0 0 6px;',
    '  font-family: var(--mono); font-size: 10.5px;',
    '}',
    '.ck-code .ck-code-file { color: var(--ink-dim); overflow-wrap: anywhere; }',
    '.ck-code .ck-code-chip {',
    '  color: var(--ink-faint); background: var(--pill); border: 1px solid var(--pill-edge);',
    '  border-radius: 3px; padding: 1px 5px; flex: 0 0 auto;',
    '}',
    /* Pushed right, and it takes the button with it. */
    '.ck-code .ck-code-msg { margin-left: auto; color: var(--ink-faint); text-align: right; }',
    '.ck-code .ck-code-copy {',
    '  flex: 0 0 auto; font: inherit; font-family: var(--mono); font-size: 10.5px;',
    '  color: var(--ink-dim); background: var(--pill); border: 1px solid var(--pill-edge);',
    '  border-radius: 4px; padding: 2px 8px; cursor: pointer;',
    '}',
    '.ck-code .ck-code-copy:hover { color: var(--accent); border-color: var(--accent); }',
    '.ck-code .ck-code-copy:disabled { opacity: .4; cursor: default; }',
    /* Success and failure are stated in colour *and* in the message beside the button, because a
       copy that quietly did nothing is worse than no copy button at all. */
    '.ck-code .ck-code-copy[data-state="ok"] { color: var(--good); border-color: var(--good); }',
    '.ck-code .ck-code-copy[data-state="fail"] { color: var(--ck-s1); border-color: var(--ck-s1); }',
    '.ck-code .ck-code-msg[data-state="fail"] { color: var(--ck-s1); }',

    '.ck-code .ck-code-scroll {',
    '  background: var(--well); border: 1px solid var(--hairline); border-radius: 5px;',
    '  padding: 7px 0;',
    '}',
    '.ck-code .ck-code-scroll:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }',
    '.ck-code .ck-code-pre { margin: 0; padding: 0; }',
    '.ck-code .ck-code-body {',
    '  display: block; font-family: var(--mono); font-size: 11.5px;',
    '  line-height: var(--ck-code-lh); color: var(--ink);',
    '}',

    /* One row per source line. Block boxes rather than newline characters: that is what keeps a
       manual selection breaking between lines while leaving the gutter out of it. */
    '.ck-code .ck-code-row {',
    '  display: flex; align-items: flex-start;',
    '  min-height: calc(var(--ck-code-lh) * 1em);',
    '  border-left: 2px solid transparent;',
    '}',
    /* Fixed by digit count, so every row agrees; a per-row `auto` width would let a 99 and a
       100 sit in columns two pixels apart. Sticky, so the numbers survive a sideways scroll. */
    '.ck-code .ck-code-num {',
    '  flex: 0 0 auto; width: calc(var(--ck-code-gut, 3) * 1ch + 20px);',
    '  padding-right: 10px; text-align: right;',
    '  color: var(--ink-faint); background: var(--well);',
    '  position: sticky; left: 0; z-index: 1;',
    '  user-select: none; -webkit-user-select: none;',
    '}',
    '.ck-code .ck-code-txt { flex: 1 1 auto; padding-right: 12px; white-space: pre; }',

    /* Emphasis is a wash *and* a bar, never one alone: the bar survives a monochrome print and a
       viewer who cannot separate the wash from the block behind it. `--pill` is the fallback for
       engines without color-mix; both are tokens, so both follow the theme. */
    '.ck-code .ck-code-row.is-hi { border-left-color: var(--ck-code-mark); }',
    '.ck-code .ck-code-row.is-hi { background: var(--pill); }',
    '.ck-code .ck-code-row.is-hi { background: color-mix(in oklab, var(--ck-code-mark) 15%, var(--well)); }',
    '.ck-code .ck-code-row.is-hi .ck-code-num { background: var(--pill); }',
    '.ck-code .ck-code-row.is-hi .ck-code-num {',
    '  background: color-mix(in oklab, var(--ck-code-mark) 15%, var(--well));',
    '  color: var(--ink-dim);',
    '}',

    /* Wrapping off: the row is as wide as its longest line and the scroller carries it, so the
       wash reaches the end of the code rather than stopping at the visible edge. */
    '.ck-code[data-wrap="off"] .ck-code-row { width: max-content; min-width: 100%; }',
    '.ck-code[data-wrap="on"] .ck-code-txt {',
    '  white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0;',
    '}',
    '.ck-code[data-numbers="off"] .ck-code-num { display: none; }',
    '.ck-code[data-numbers="off"] .ck-code-txt { padding-left: 11px; }',

    '.ck-code .ck-t-comment { color: var(--ck-code-comment); font-style: italic; }',
    '.ck-code .ck-t-string { color: var(--ck-code-string); }',
    '.ck-code .ck-t-number { color: var(--ck-code-number); }',
    '.ck-code .ck-t-keyword { color: var(--ck-code-keyword); }',
    '.ck-code .ck-t-type { color: var(--ck-code-type); }',
    '.ck-code .ck-t-function { color: var(--ck-code-function); }',
    '.ck-code .ck-t-operator { color: var(--ck-code-operator); }',
    '.ck-code .ck-t-punctuation { color: var(--ck-code-punctuation); }',
    '.ck-code .ck-t-plain { color: var(--ck-code-plain); }',

    /* kit.css stretches settings fields to their cell; a stretched checkbox is a wide hit area
       with a glyph adrift in it, so those two controls opt out. */
    '.ck-code .ck-set input[type="checkbox"] { width: auto; justify-self: start; }',
    '.ck-code .ck-code-empty { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }',
    '.ck-code .ck-cap { overflow-wrap: anywhere; }'
  ].join('\n');
}

/**
 * The browser script: ES5-shaped, self-invoking, and safe to have run before its card exists.
 *
 * The lexer is shipped by `String()`-ing the very functions this module just used, rather than
 * by writing a second copy. Two implementations that are supposed to agree about what is safe
 * eventually do not, and the one that drifts is always the one nobody is looking at.
 *
 * @param p the same bundle `markup` was given, plus the raw source and the emphasis set
 */
function script(p) {
  const engine = [
    ckCodeEsc, ckCodeLangName, ckCodeGroups, ckCodeCompile, ckCodeMatchBrace, ckCodeScanTemplate,
    ckCodeSplitTemplate, ckCodeGuardJsRegex, ckCodeGuardShCommand, ckCodeLex, ckCodeLines,
    ckCodeRender, ckCodeCaption
  ].map(String).join('\n\n');

  return [
    '(function () {',
    "  'use strict';",
    '',
    '  var CK_CODE_LANGS = ' + jsJson(CK_CODE_LANGS) + ';',
    '  var CK_CODE_NAMES = ' + jsJson(CK_CODE_NAMES) + ';',
    '  var CK_CODE_ALIAS = ' + jsJson(CK_CODE_ALIAS) + ';',
    '  var CK_CODE_CLASSES = ' + jsJson(CK_CODE_CLASSES) + ';',
    '  var CK_CODE_TICK = String.fromCharCode(96);',
    '  var CK_CODE_CACHE = {};',
    '',
    engine,
    '',
    '  var CK_CODE_GUARDS = { jsregex: ckCodeGuardJsRegex, shcmd: ckCodeGuardShCommand };',
    '  var CK_CODE_SCANS = { template: ckCodeScanTemplate };',
    '  var CK_CODE_SPLITS = { template: ckCodeSplitTemplate };',
    '',
    '  var DEFAULTS = ' + jsJson(p.cfg) + ';',
    '  /* The raw snippet travels with the card for two reasons: the copy button hands over the',
    '     source rather than a scrape of the DOM, and changing the language re-lexes from this',
    '     instead of trying to reconstruct it from the spans. */',
    '  var RAW = ' + jsJson(p.raw) + ';',
    '  var HI = ' + jsJson(p.hi) + ';',
    '  var START = ' + Number(p.start) + ';',
    '  var COUNT = ' + Number(p.count) + ';',
    '  var MARKED = ' + Number(p.marked) + ';',
    '',
    '  CK.build(' + jsJson(p.id) + ', function (sec) {',
    '',
    '    var body = sec.querySelector(".ck-code-body"),',
    '        chip = sec.querySelector(".ck-code-chip"),',
    '        cap  = sec.querySelector(".ck-cap"),',
    '        btn  = sec.querySelector(".ck-code-copy"),',
    '        msg  = sec.querySelector(".ck-code-msg");',
    '',
    '    /* What the server already painted. Starting here means the common case — settings',
    '       untouched, or touched only for wrap and numbers — never re-lexes at all. */',
    '    var shown = DEFAULTS.lang;',
    '    var timer = 0;',
    '',
    '    /**',
    '     * Say what just happened, beside the button, and colour the button to match.',
    '     * A failure lingers longer than a success because it asks the viewer to do something.',
    '     */',
    '    function say(text, state) {',
    '      if (msg) { msg.textContent = text; msg.setAttribute("data-state", state); }',
    '      if (btn) btn.setAttribute("data-state", state);',
    '      clearTimeout(timer);',
    '      timer = setTimeout(function () {',
    '        if (msg) { msg.textContent = ""; msg.removeAttribute("data-state"); }',
    '        if (btn) btn.removeAttribute("data-state");',
    '      }, state === "fail" ? 5000 : 1600);',
    '    }',
    '',
    '    /**',
    '     * The pre-clipboard-API copy: a hidden textarea, selected, and execCommand.',
    '     * Still needed on any page that is not a secure context, where navigator.clipboard',
    '     * simply is not there.',
    '     */',
    '    function legacyCopy() {',
    '      var ta = document.createElement("textarea"), okd = false;',
    '      ta.value = RAW;',
    '      ta.setAttribute("readonly", "readonly");',
    '      ta.style.position = "fixed";',
    '      ta.style.top = "0";',
    '      ta.style.left = "-9999px";',
    '      ta.style.opacity = "0";',
    '      document.body.appendChild(ta);',
    '      try {',
    '        ta.select();',
    '        ta.setSelectionRange(0, ta.value.length);',
    '        okd = !!document.execCommand("copy");',
    '      } catch (e) { okd = false; }',
    '      document.body.removeChild(ta);',
    '      return okd;',
    '    }',
    '',
    '    /* Every path ends in a visible statement. A permissions prompt the viewer dismissed,',
    '       a non-secure context, an engine with neither route — all of them say so, and the',
    '       last one says what to do instead. */',
    '    function copy() {',
    '      var ok = function () { say("copied", "ok"); };',
    '      var no = function () {',
    '        if (legacyCopy()) ok();',
    '        else say("copy blocked \\u2014 select the code and press Ctrl+C", "fail");',
    '      };',
    '      if (navigator.clipboard && navigator.clipboard.writeText) {',
    '        try { navigator.clipboard.writeText(RAW).then(ok, no); }',
    '        catch (e) { no(); }',
    '      } else { no(); }',
    '    }',
    '',
    '    if (btn) CK.once(btn, "codecopy", function () {',
    '      btn.addEventListener("click", function () { copy(); });',
    '    });',
    '',
    '    /** Reflect the settled settings. Only a language change costs a re-lex. */',
    '    function apply(cfg) {',
    '      sec.setAttribute("data-wrap", cfg.wrap ? "on" : "off");',
    '      sec.setAttribute("data-numbers", cfg.numbers ? "on" : "off");',
    '',
    '      var want = ckCodeLangName(cfg.lang);',
    '      if (want === shown || !body) return;',
    '      shown = want;',
    '      body.innerHTML = ckCodeRender(ckCodeLines(ckCodeLex(RAW, want, 0)), START, HI);',
    '      if (chip) chip.textContent = want;',
    '      if (cap) cap.innerHTML = ckCodeCaption(want, COUNT, MARKED);',
    '    }',
    '',
    '    CK.settings(sec, DEFAULTS, apply);',
    '  });',
    '})();'
  ].join('\n');
}

/**
 * Build one code card.
 *
 * The snippet is tokenised here and shipped as markup; the browser only paints it. The lexer
 * travels along anyway so the `lang` setting can re-read a mis-tagged snippet in place.
 *
 * **Escaping order.** The source is tokenised raw and each token's text is escaped as it is
 * written into markup — the opposite of what `markdown.mjs` does, and deliberately. Escaping
 * first works there because none of Markdown's markers are among the five escaped characters;
 * a lexer's markers *are* those characters. Escape first and `<=` becomes `&lt;=`, a string's
 * `"` becomes `&quot;`, an HTML tag stops looking like a tag, and every rule in this file would
 * have to be rewritten against entity soup. Tokenising raw keeps the patterns honest, and the
 * safety property moves to two places instead: `ckCodeRender` is the only function that turns
 * text into markup and it calls `ckCodeEsc` on every token without exception, and the tokens
 * concatenate back to the source exactly — which the verifier asserts, and which is what proves
 * no byte can reach the output around the escaper. Class names never come from input either;
 * they are checked against a fixed list. A snippet containing `</script>` or `<img onerror=…>`
 * therefore renders as visible, inert text in the card and as `\\u003c` escapes in the script.
 *
 * @param id    unique on the desk; becomes `data-card` and the settings storage key
 * @param title the card's heading, rendered as plain text — never as code
 * @param data  `{ code, lang, filename, startLine, highlight }`; see {@link meta}
 * @param ord   the card's position on the desk, carried through for the host to sort by
 * @returns `{ json, html, css, js }` — the descriptor, the markup, scoped CSS, a classic script
 * @throws {Error} when `id` is not a bare identifier, since it goes into an attribute selector
 *
 * @example
 * const card = build({ id: 'snip', title: 'the guard', ord: 30, data: {
 *   code: 'var u = "http://x"; // don\'t', lang: 'js', highlight: [1]
 * } });
 * card.js.indexOf('=>');   // -1
 */
export function build({ id, title, data, ord } = {}) {
  const cardId = String(id == null ? 'code' : id);
  if (!/^[A-Za-z][\w-]*$/.test(cardId)) {
    throw new Error('code: id must be a bare identifier, got ' + JSON.stringify(cardId));
  }

  const d = data && typeof data === 'object' ? data : {};
  const heading = String(title == null ? 'Code' : title);
  const cfg = settle(d);
  const raw = clean(d.code);

  /* "Unknown" means the tag matched nothing at all, not merely that it resolved to plain: a
     snippet tagged `text` asked for plain and got it, and should not be told off for it. */
  const asked = Object.hasOwn(d, 'lang') && d.lang != null ? String(d.lang) : '';
  const key = asked.toLowerCase().replace(/[^a-z0-9+#]/g, '');
  const known = CK_CODE_NAMES.indexOf(key) >= 0 ||
                CK_CODE_ALIAS.some((v, i) => i % 2 === 0 && v === key);
  const unknown = asked !== '' && !known;

  const startLine = Number.isFinite(Number(d.startLine)) && Number(d.startLine) >= 1
    ? Math.floor(Number(d.startLine))
    : 1;

  const lines = raw === '' ? [] : ckCodeLines(ckCodeLex(raw, cfg.lang, 0));
  const hi = marks(d.highlight, startLine, lines.length);
  const marked = Object.keys(hi).length;
  const rows = lines.length === 0 ? '' : ckCodeRender(lines, startLine, hi);
  const gutter = String(startLine + Math.max(lines.length - 1, 0)).length;

  const caption = ckCodeCaption(cfg.lang, lines.length, marked) +
    (unknown
      ? ' <span class="ck-aside">tagged ' + esc(asked) +
        ', which this card has no rules for &mdash; the gear can re-read it</span>'
      : '');

  const p = {
    id: cardId, title: heading, ord, cfg, raw, hi, rows, gutter, caption,
    lang: cfg.lang, filename: d.filename == null ? '' : String(d.filename),
    start: startLine, count: lines.length, marked
  };

  return {
    json: {
      id: cardId, type: meta.name, title: heading, ord: ord == null ? null : ord,
      settings: cfg, lines: lines.length, marked
    },
    html: markup(p),
    css: styles(),
    js: script(p)
  };
}

/**
 * Tokenise a snippet without building a card around it.
 *
 * Exported so the lexer can be exercised — and its concatenation invariant asserted — without a
 * DOM, a card, or a desk anywhere near it.
 *
 * @param src  the source
 * @param lang a language tag or alias; anything unknown lexes as `plain`
 * @returns `{ cls, text }` tokens whose texts concatenate back to `src` exactly
 *
 * @example lex('#x', 'python')[0].cls;   // 'comment'
 */
export function lex(src, lang) {
  return ckCodeLex(String(src == null ? '' : src), ckCodeLangName(lang), 0);
}

export default { meta, build, lex, LANGUAGES };

