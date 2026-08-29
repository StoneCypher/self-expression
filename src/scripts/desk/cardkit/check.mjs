/**
 * Hold every card type to the contract, permanently.
 *
 * Each type arrived with its own throwaway verifier, run once and deleted — which proved the type
 * was right on the day it was written and proves nothing about tomorrow. This is the part that
 * stays: one check, over the whole catalogue, that fails loudly when a type drifts.
 *
 * It deliberately re-derives rather than trusting. `meta.defaults` is compared against the field
 * names the type actually emits, in both directions, because a settings panel that has quietly
 * stopped matching its defaults is the failure that looks like nothing.
 *
 *     node check.mjs            every type
 *     node check.mjs clock      one type
 *
 * @example
 * node check.mjs   // 32 types checked, 0 faults
 */

import { readFileSync } from 'node:fs';
import { Script }       from 'node:vm';
import { catalogue }    from './newcard.mjs';
import { isCategory, CATEGORY_KEYS } from './categories.mjs';

/** A control character that is not tab, LF or CR, compared numerically. */
const ctrlAt = (text) => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) return { at: i, code: c };
  }
  return null;
};

/**
 * Blank comment and string bodies, preserving offsets and newlines.
 *
 * A raw scan for `const` / `let` / `class` false-positives on English prose — one card was refused
 * because a comment said "the class is what CSS reads". Offsets are preserved so a reported
 * position still means something, and regex literals are recognised, because otherwise the scanner
 * desyncs on the quote in `replace(/'/g, x)` and blanks real code — turning a false positive into
 * a far worse false negative.
 *
 * @param src JavaScript source
 * @returns the same length of text with comment and string contents replaced by spaces
 */
function blankNonCode(src) {
  const out = src.split('');
  let i = 0, prev = '';
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    /* A slash is a regex only where a value cannot precede it. Tracking the previous significant
       character is the cheap approximation that gets this right for real code. */
    if (c === '/' && !/[\w)\]]/.test(prev)) {
      let k = i + 1, cls = false;
      while (k < src.length && (cls || src[k] !== '/')) {
        if (src[k] === '\\') k++;
        else if (src[k] === '[') cls = true;
        else if (src[k] === ']') cls = false;
        k++;
      }
      blank(i + 1, k); i = k + 1; prev = ')'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/**
 * Every way one type can be off the contract.
 *
 * @param name the type's name, which must match its filename
 * @param mod  the loaded module
 * @returns a list of complaints, empty when the type conforms
 */
export function faults(name, mod) {
  const bad  = [];
  const meta = mod.meta ?? {};

  if (meta.name !== name)              bad.push(`meta.name is ${JSON.stringify(meta.name)}, not ${name}`);
  if (typeof meta.summary !== 'string' || !meta.summary.trim()) bad.push('meta.summary missing');
  else if (!meta.summary.trim().endsWith('.')) bad.push('meta.summary does not end in a period');
  if (typeof meta.shape !== 'string' || !meta.shape.trim())
    bad.push(`meta.shape must be a string, got ${typeof meta.shape}`);

  /* Exactly one category, and a real one. An uncategorised type is invisible in the gallery,
     which is the surface a newcomer uses to find out what exists — so a missing category does
     not degrade the catalogue, it hides part of it, and nobody notices for months. */
  if (!isCategory(meta.category)) {
    bad.push(`meta.category is ${JSON.stringify(meta.category)}; expected one of ` +
             CATEGORY_KEYS.join(', '));
  }

  let built;
  try { built = mod.build({ id: name + '-probe', title: 'probe', data: undefined, ord: 50 }); }
  catch (e) { bad.push(`build() threw on absent data: ${e.message}`); return bad; }

  const html = built.html ?? '', css = built.css ?? '', js = built.js ?? '';

  /* One section, unless the type declares itself a container.
     The rule exists because a type emitting two sections is nearly always a bug — a stray tag, a
     template closed in the wrong place. A card that HOLDS cards is the honest exception, and it
     has to say so in its own metadata rather than being inferred, so the check keeps its teeth for
     everyone else. A container's children are still cards: their own `data-card`, their own
     builder, their own independent repaint. */
  const sections = (html.match(/<section\b/g) ?? []).length;
  if (meta.contains === true) {
    if (sections < 1) bad.push('declares meta.contains but emits no <section>');
  } else if (sections !== 1) {
    bad.push(`html has ${sections} <section> elements, expected 1 ` +
             '(set meta.contains: true if this type holds other cards)');
  }
  if (!html.includes(`data-card="${name}-probe"`)) bad.push('html does not carry the given card id');

  /* Every card id on the page must be unique, nested or not — two sections answering to one id
     means `CK.card` finds the first and the second is dead markup that will never be painted. */
  const ids = [...html.matchAll(/data-card="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) {
    bad.push(`duplicate data-card ids within one build: ${ids.join(', ')}`);
  }

  /* The panel and the defaults must agree in BOTH directions: a field with no default is a control
     that forgets, and a default with no field is a setting nobody can reach. */
  const emits = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(m => m[1]);
  const keys  = Object.keys(meta.defaults ?? {});
  if (emits.length && !keys.length) bad.push('emits settings fields but declares no meta.defaults');
  for (const f of new Set(emits)) if (!keys.includes(f)) bad.push(`panel field "${f}" is not in meta.defaults`);
  for (const k of keys) if (!emits.includes(k)) bad.push(`meta.defaults.${k} has no panel field`);
  if (keys.length && !/class="ck-gear"/.test(html)) bad.push('has settings but no .ck-gear');

  for (const [what, text] of [['html', html], ['css', css], ['js', js]]) {
    const hit = ctrlAt(text);
    if (hit) bad.push(`${what}: control character ${hit.code} at offset ${hit.at}`);
  }

  if (js) {
    if (js.includes(String.fromCharCode(96))) bad.push('js contains a backtick');
    if (/=>/.test(js))   bad.push('js contains an arrow function');
    if (/\?\./.test(js)) bad.push('js contains optional chaining');
    const code = blankNonCode(js);
    for (const kw of ['const', 'let', 'class']) {
      const m = new RegExp(`(^|[^\\w$.])${kw}[\\s({]`).exec(code);
      if (m) bad.push(`js declares ${kw} (offset ${m.index})`);
    }
    try { new Script(js); } catch (e) { bad.push(`js does not parse: ${e.message}`); }
  }

  if (/prefers-color-scheme/.test(css)) bad.push('css keys off prefers-color-scheme');

  /* Colour is checked per declaration value, since `white-space` is a property name that contains
     one — and `:root` blocks are cut out first, because the contract explicitly permits a type to
     define its own token there and override it under `:root[data-theme="light"]`. Scanning them
     would flag exactly the sanctioned way of needing a colour. */
  const outsideRoot = css.replace(/:root[^{]*\{[^}]*\}/g, '');
  for (const [, value] of outsideRoot.matchAll(/:\s*([^;{}]+);/g)) {
    if (/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)\(/i.test(value) && !/var\(/.test(value)) {
      bad.push(`css names a literal colour outside :root — ${value.trim().slice(0, 60)}`);
      break;
    }
  }

  /* Only in what is RENDERED. Emitted script legitimately contains the words: a card that guards
     against a non-finite value says `isNaN` or compares against `Infinity`, and flagging that
     punishes the types that are careful. The failure worth catching is one of them reaching the
     page. */
  if (/\bNaN\b|\bInfinity\b/.test(html)) bad.push('html contains NaN or Infinity');

  return bad;
}

/**
 * Break a conforming type on purpose, and require the check to notice.
 *
 * A suite that has never failed has not been shown to work — the evening's own lesson, learned when
 * an agent mutation-tested a clean 201/201 and found the eighth break sailed through. So this check
 * proves itself before it judges anything else.
 *
 * @returns the number of mutations that escaped, which should be zero
 */
function selftest() {
  const sound = () => ({
    meta: { name: 'probe', summary: 'A conforming probe type.', shape: '{ x }', defaults: { a: 1 } },
    build: () => ({
      json: { ord: 50 },
      html: '<section data-card="probe-probe" class="ck-probe"><h2>p</h2>' +
            '<button class="ck-gear"></button><div class="ck-set" hidden>' +
            '<input name="a" type="number"></div></section>',
      css:  '.ck-probe { color: var(--ink); }',
      js:   'CK.build("probe-probe", function (sec) { var n = 1; });',
    }),
  });

  const nul = String.fromCharCode(0), tick = String.fromCharCode(96);
  const breaks = [
    ['name mismatch',      m => { m.meta.name = 'other'; }],
    ['summary missing',    m => { delete m.meta.summary; }],
    ['summary unpunctuated', m => { m.meta.summary = 'no full stop'; }],
    ['shape not a string', m => { m.meta.shape = { x: 1 }; }],
    ['build throws',       m => { m.build = () => { throw new Error('boom'); }; }],
    ['two sections',       m => { const b = m.build; m.build = a => { const r = b(a); r.html += '<section></section>'; return r; }; }],
    ['field without default', m => { const b = m.build; m.build = a => { const r = b(a); r.html = r.html.replace('name="a"', 'name="zz"'); return r; }; }],
    ['default without field', m => { m.meta.defaults.b = 2; }],
    ['control char in html', m => { const b = m.build; m.build = a => { const r = b(a); r.html = r.html.replace('<h2>p', '<h2>p' + nul); return r; }; }],
    ['backtick in js',     m => { const b = m.build; m.build = a => { const r = b(a); r.js += ' /* ' + tick + 'x' + tick + ' */'; return r; }; }],
    ['arrow in js',        m => { const b = m.build; m.build = a => { const r = b(a); r.js += ' var f = function () { return 0; }; var g = () => 1;'; return r; }; }],
    ['const in js',        m => { const b = m.build; m.build = a => { const r = b(a); r.js += ' const q = 1;'; return r; }; }],
    ['js does not parse',  m => { const b = m.build; m.build = a => { const r = b(a); r.js += ' function ('; return r; }; }],
    ['literal colour',     m => { const b = m.build; m.build = a => { const r = b(a); r.css += ' .ck-probe b { color: oklch(0.8 0.1 90); }'; return r; }; }],
    ['prefers-color-scheme', m => { const b = m.build; m.build = a => { const r = b(a); r.css += ' @media (prefers-color-scheme: dark) { .ck-probe { color: var(--ink); } }'; return r; }; }],
    ['NaN in html',        m => { const b = m.build; m.build = a => { const r = b(a); r.html = r.html.replace('<h2>p', '<h2>NaN'); return r; }; }],
  ];

  if (faults('probe', sound()).length) {
    console.log('✗ selftest: the sound probe was rejected');
    for (const f of faults('probe', sound())) console.log(`    ${f}`);
    return 1;
  }

  /* Prose that LOOKS like a violation must pass, or the check gets switched off. */
  const proseOk = sound();
  const inner = proseOk.build;
  proseOk.build = a => { const r = inner(a);
    r.js += ' /* the class is what CSS reads, and let it stay that way */ var s = "const";';
    return r; };
  if (faults('probe', proseOk).length) {
    console.log('✗ selftest: prose mentioning const/class/let was wrongly refused');
    for (const f of faults('probe', proseOk)) console.log(`    ${f}`);
    return 1;
  }

  let escaped = 0;
  for (const [label, mutate] of breaks) {
    const m = sound();
    mutate(m);
    if (!faults('probe', m).length) { escaped++; console.log(`✗ selftest: "${label}" was not caught`); }
  }
  console.log(`selftest: ${breaks.length - escaped}/${breaks.length} mutations caught, prose lookalike passed`);
  return escaped;
}

const only = process.argv[2];

if (only === '--selftest') { process.exit(selftest() ? 1 : 0); }

const cat  = await catalogue();
let checked = 0, failed = 0;

for (const [name, mod] of [...cat].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (only && name !== only) continue;
  checked++;
  const bad = faults(name, mod);
  if (bad.length) {
    failed++;
    console.log(`✗ ${name}`);
    for (const b of bad) console.log(`    ${b}`);
  }
}

/* Sources too, not only what they emit: two of the evening's parse failures were in the module
   itself, where a check on the emitted script cannot reach. */
for (const [name] of cat) {
  if (only && name !== only) continue;
  const src = readFileSync(new URL(`./types/${name}.mjs`, import.meta.url), 'utf8');
  const hit = ctrlAt(src);
  if (hit) { failed++; console.log(`✗ ${name}\n    source: control character ${hit.code} at offset ${hit.at}`); }
}

console.log(`\n${checked} types checked, ${failed} with faults`);
process.exit(failed ? 1 : 0);
