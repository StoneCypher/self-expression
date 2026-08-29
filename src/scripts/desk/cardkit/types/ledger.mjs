/**
 * The `ledger` card type — rows carrying a status marker, optional headings, and per-row verbs.
 *
 * This is the desk's own inbox, generalised. The inbox was written by hand and knew what its
 * buttons meant; this type deliberately does not. A verb click dispatches
 * `CustomEvent('ck-ledger', { detail: { id, verb }, bubbles: true })` on the `<section>` and
 * stops there. There is no allowlist of verbs, no `fetch` anywhere in this file, and no idea
 * what "merge" or "snooze" is supposed to do — which is precisely what makes this a card type
 * rather than a second copy of the inbox. Two desks can decide differently about the same verb.
 *
 * Four decisions worth defending before you read the code:
 *
 *   1. **The marker vocabulary is borrowed, not invented.** The project already has one, in
 *      `src/doc_md/reference/markers.md` (prose, canonical) and `src/ts/charts/markers.ts`
 *      (machine-readable). Both are transcribed into {@link MARKERS}, {@link SUCCESS} and
 *      {@link FAILURE} below. Inventing a second vocabulary for the same glyphs is exactly the
 *      drift the contract exists to prevent, and a checklist that reads one way in a terminal
 *      and another way on the desk is worse than no checklist.
 *   2. **An unknown marker renders.** It is drawn as given and counted in the residual bucket,
 *      and the caption says how many rows carried one. Dropping the row would lose content the
 *      caller handed over in order to hide the fact that this file's vocabulary is out of date;
 *      the row is the reader's, the vocabulary is ours.
 *   3. **An empty group is not a heading.** A heading with nothing under it reads as a category
 *      the reader has to go and check. Emptiness is decided at *runtime*, because hiding struck
 *      rows can empty a group that was full when the card was built — so grouping is applied by
 *      the browser half, over markup Node already wrote.
 *   4. **A struck row stays.** It renders struck through and dimmed and keeps its verbs, until
 *      something outside the card dismisses it. A row that vanished when you acted on it takes
 *      its own evidence with it: you cannot see what you just did, or undo the wrong click.
 *
 * As with `table`, every row is rendered here, in Node, escaped, in source order; the browser
 * script only ever *rearranges* and hides markup that already exists. There is exactly one place
 * where data becomes markup and exactly one escape to get right, and the card still says what it
 * knows — as a flat list, with no headings — if the script never runs.
 *
 * @see meta for the accepted shape
 * @see MARKERS for the vocabulary and its canonical order
 */

/* ── the marker vocabulary ───────────────────────────────────────────────────────────────── */

/**
 * Every marker from the project's `markers.md`, in its canonical order.
 *
 * Transcribed from `src/ts/charts/markers.ts`'s `CANONICAL_ORDER`, which is itself the
 * promotion of `src/doc_md/reference/markers.md` to code: the status markers in their listed
 * order (with 💯 spliced in immediately after ✅, per the rule stated in prose there), then the
 * topic/action groups top to bottom, each group left to right.
 *
 * The order is load-bearing twice over. It is the tiebreaker for the summary's icon list —
 * equal-count markers sort by first appearance here — and it is the membership test that decides
 * whether a row's marker is "known", which the caption reports on.
 *
 * A note on the strings, lifted from `markers.ts` because it is the trap: several markers are
 * multi-code-point, a base emoji followed by U+FE0F VARIATION SELECTOR-16 which forces the emoji
 * presentation of an otherwise text-default glyph (🛠️, 🛳️, 🎙️, 🕵️ and others). Every comparison
 * in this file is plain string equality — no normalisation, no stripping of variation selectors.
 * A visually identical but code-point-different string will not match, and will be reported as
 * an unknown marker rather than silently folded into a known one.
 *
 * @example MARKERS.indexOf('\u2705');   // 0 — ✅ leads the canonical order
 */
export const MARKERS = [
  '✅',  // done
  '💯',  // a perfect pass (the variant of done; ranks just after it)
  '🤖',  // running in an agent
  '⏳',  // running in general
  '🌐',  // web search or web read in progress
  '🔬',  // under review
  '🔁',  // in a fix round
  '🛠️',  // deferred to a skill
  '🛰️',  // monitoring — a dependency-wait
  '🔜',  // queued
  '🦥',  // a long wait
  '🌗',  // partial/degraded
  '🫨',  // flaky, intermittent, nondeterministic
  '🦡',  // a retry after a prior failure
  '❌',  // failed
  '🚫',  // blocked by something outside our control
  '🦗',  // an external party has gone silent
  '⏭️',  // skipped intentionally
  '⏸️',  // paused/deferred
  '❗',  // needs attention now
  '⚠️',  // caution / worked-with-a-caveat
  '⏰',  // on a timer or cron
  '😴',  // dormant
  '🧠',  // handed to the user for review
  '❓',  // open question for the user
  '🤔',  // judgment call to weigh
  '📋',  // making a plan
  '🐙',  // coordination work
  '📅',  // schedules, reminders, deadlines
  '📩',  // sending a communication
  '👔',  // writing a presentation, review, or pitch
  '📝',  // recording data, notes, results, a report
  '📖',  // writing documentation
  '📎',  // attaching assets or evidence
  '📺',  // uploading a video
  '🎙️',  // managing spoken assets
  '🖨️',  // creating a physical asset
  '🧪',  // writing tests
  '🦆',  // a deliberate fake, stub, mock, or placeholder
  '🔍',  // research or lookup
  '🔗',  // external integration
  '🎫',  // issue-tracker work
  '🏁',  // finishing a major goal
  '🪚',  // refactoring
  '🐀',  // a rat's nest
  '⚡',  // performance work
  '🐛',  // recording a defect
  '🧹',  // cleanup or formatting
  '🗑️',  // major removal
  '🦤',  // deprecating or sunsetting
  '🧐',  // a review or scrutiny step
  '⚖️',  // compliance, auditing, verification
  '👑',  // authorized or vetted by a third party
  '👍',  // agreeing to something
  '👎',  // declining something
  '✋',  // preventing something
  '🛳️',  // deploying something
  '♾️',  // DevOps work
  '↩️',  // rolling back a deploy
  '🏗️',  // provisioning infrastructure
  '📦',  // building an image or artifact
  '⚙️',  // configuration work
  '🔑',  // secrets or credentials
  '🩹',  // patching or applying updates
  '🩺',  // health checks and uptime monitoring
  '☸️',  // orchestration and infrastructure-as-code
  '⬆️',  // bringing a server up
  '⬇️',  // bringing a server down
  '⏫',  // scaling out
  '⏬',  // scaling in
  '🔌',  // appliances, wiring, power
  '💽',  // database work
  '🧬',  // schema changes and migrations
  '🌱',  // seed or fixture data
  '💾',  // backups or restores
  '🪵',  // logging tasks
  '🧮',  // calculation, generating data from data
  '📊',  // data analysis, metrics, conversion
  '🔮',  // a forecast, projection, or estimate
  '🔥',  // incident, outage, firefighting
  '🚨',  // alert fired or incident declared
  '🧯',  // incident containment
  '🤕',  // post-incident recovery
  '🗿',  // recovering one crashed or stalled task
  '🪦',  // a post-mortem or retrospective
  '🕵️',  // debugging, root-cause analysis
  '🦓',  // a rare or unlikely root cause
  '🏷️',  // tags, releases, version labels
  '🔀',  // merging branches or pull requests
  '🚀',  // git push to a remote
  '🔨',  // build tasks
  '🆙',  // a deliberate version upgrade
  '🤮',  // generating static assets, bulk text into a data file
  '🎨',  // creative assets, UI/UX, brand
  '♿',  // accessibility audits and fixes
  '📐',  // measurement, schematics, verification against a spec
  '🗺️',  // translation, localization, internationalization
  '🎣',  // social engineering or phishing
  '🪓',  // a brute-force attack or approach
  '🦹',  // a discovered security problem
  '🪪',  // cloud credentials or IAM
  '🩻',  // forensics, malware analysis, reverse engineering
  '🔒',  // encryption, certificates, data at rest
  '🕳️',  // honeypots, tarpits, sinkholes
  '🐒',  // offensive-security / red-team work
  '🧌',  // abuse, spam, trolling, a bad actor
  '🤬',  // we believe we are under active attack
  '🛡️',  // defensive security or hardening
  '👁️',  // IDS, telemetry, session monitoring
  '💰',  // financial in nature
  '🌪️',  // a large requirements change
  '🧊',  // freezing a topic
  '👻',  // something has disappeared, cause unknown
  '💀',  // a process is unexpectedly dead
  '🧟',  // a process is hung or defunct
  '🌋',  // a serious problem or threat
  '🤡',  // going wrong stupidly or repeatedly
  '😕',  // something is wrong, cause not yet known
  '🤌',  // rejected or denied with no stated reason
  '🤥',  // a claim or dataset is suspect
  '🥵',  // under heavy load
  '😎',  // something genuinely cool happened
  '🦙',  // a judgmental or drama-prone topic
  '💅',  // a sassy, unbothered, pointed remark
  '🤓',  // nerdy, pedantic, hyper-detailed material
];

/**
 * The markers that count toward the summary's `success` bucket.
 *
 * Transcribed from `markers.ts`'s `SUCCESS_MARKERS`, which follows `markers.md` § Bucket
 * membership. ⚠️ is here on purpose and it looks wrong until you read the rule: caveated work
 * still landed, and the caveat stays visible in the icon list rather than in the tally.
 *
 * 🛳️ is deliberately absent. A deploy's bucket depends on whether it finished, which the glyph
 * cannot carry — the row's own `bucket` field is how a caller says which it was.
 *
 * @example SUCCESS.indexOf('\u26A0\uFE0F') >= 0;   // true — ⚠️ counts as landed
 */
export const SUCCESS = ['✅', '💯', '🏁', '👍', '😎', '⚠️'];

/**
 * The markers that count toward the summary's `failure` bucket.
 *
 * Transcribed from `markers.ts`'s `FAILURE_MARKERS`: failed, blocked, gone silent, the
 * dead/hung/degraded process family, a discovered security problem, a serious threat, active
 * attack, and the "something is wrong" family.
 *
 * @example FAILURE.indexOf('\u274C') >= 0;   // true
 */
export const FAILURE = [
  '❌', '🚫', '🦗', '💀', '🧟', '🦹', '🌋', '🤬',
  '🤡', '😕', '🤌', '🤥', '🥵', '😴', '🫨', '🌗',
];

/** The three buckets, in the canonical order the tally prints them. */
const BUCKETS = ['success', 'active', 'failure'];

/* ── the type ────────────────────────────────────────────────────────────────────────────── */

/**
 * Every setting this card understands, with the value that stands when nothing is stored.
 *
 * These three keys and the `name` attributes in the card's `<div class="ck-set">` are one thing
 * seen twice, and the verifier checks it in both directions: a field whose `name` has drifted is
 * ignored by `CK.settings` — correctly, and silently — and looks exactly like a control that
 * does nothing.
 *
 * `showStruck` defaults on because a struck row is evidence of work, not clutter; `group`
 * defaults on because a caller who supplied `groups` meant them, and a card with no groups is
 * unaffected either way.
 *
 * @example defaults.showStruck;   // true
 */
export const defaults = { dense: false, showStruck: true, group: true };

/**
 * What this card type is and what it eats, for the desk's type picker and for tooling.
 *
 * `shape` is a string and `defaults` is an object, per the contract: the first is read by a
 * person choosing a type and has to scan at a glance, the second is read by a machine checking a
 * panel's fields against it.
 *
 * @example meta.name;                    // 'ledger'
 * @example Object.keys(meta.defaults);   // ['dense', 'showStruck', 'group']
 */
export const meta = {
  name: 'ledger',
  summary: 'Rows carrying a status marker and per-row verbs, optionally split under headings, ' +
           'with a counts line derived from the project marker vocabulary.',
  shape: '{ rows: [{ id, marker, text, tag, href, struck, note }], ' +
         'verbs: [{ key, title, icon }], groups: [{ key, label, rowIds }], summary } — ' +
         'marker is one glyph from markers.md; summary is true, or a noun for the counts line',
  defaults: { ...defaults },
};

/* ── escaping and embedding ──────────────────────────────────────────────────────────────── */

/**
 * HTML-escape a value, mirroring `CK.esc` byte for byte.
 *
 * Duplicated rather than imported because `kit.js` is a classic script and not a module. The two
 * must agree exactly: a card whose Node side and browser side disagree about what is safe is a
 * card with a hole in whichever side is more permissive.
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
 * A JavaScript string literal for a value, safe to paste into the emitted classic script.
 *
 * `JSON.stringify` alone is not enough for text that lands inside a `<script>` element: `</`
 * would close it, and U+2028/U+2029 are line terminators to a JS parser but not to JSON. The
 * backtick and the question mark are escaped for a different reason — this type's verifier
 * asserts the emitted script contains no template literals and no optional chaining, and a card
 * id containing a backtick would fail that check with a mystifying message about a rule it did
 * not break. Cheaper to make the data unable to spell the forbidden tokens at all.
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
 * A safe `href`, or '' when the value is not one.
 *
 * Allowlisted by parsing rather than blacklisted by matching, as the contract requires: the URL
 * is parsed and its protocol compared against exactly two values, so `javascript:`, `data:`,
 * `vbscript:` and every scheme nobody has thought of yet fail by default rather than by being
 * remembered. Relative URLs are rejected too — a desk card has no base worth guessing at, and a
 * link that resolves against whatever page hosts the card means something different on each one.
 *
 * @param v the caller's `href`, possibly absent or hostile
 * @returns the normalised absolute URL, or '' when it must not be linked
 *
 * @example safeHref('https://example.com/x');   // 'https://example.com/x'
 * @example safeHref('javascript:alert(1)');     // ''
 * @example safeHref('/issues/3');               // ''
 */
function safeHref(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (s === '') return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

/**
 * Drop C0 control characters and DEL from a caller's text, keeping nothing invisible.
 *
 * Written as code-point arithmetic rather than as a character class on purpose, per contract
 * rule 6. A class like that has to be spelled with escapes, and an escape decoded one step too
 * early puts the raw control character into this file, where it is invisible in every editor,
 * legal to the parser, and survives `node --check`. Comparing numbers cannot go wrong that way.
 *
 * Tab and newline go too, unlike the code card's version: a ledger row is a single line of
 * running text, and a tab in it is either a paste accident or an attempt to fake a column.
 *
 * @param s the text to clean
 *
 * @example clean('a\tb').length;   // 2
 */
function clean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) continue;
    out += ch;
  }
  return out;
}

/* ── markers ─────────────────────────────────────────────────────────────────────────────── */

/** VARIATION SELECTOR-16 and -15, ZERO WIDTH JOINER, and COMBINING ENCLOSING KEYCAP. */
const VS16 = 0xFE0F, VS15 = 0xFE0E, ZWJ = 0x200D, KEYCAP = 0x20E3;
/** The EMOJI MODIFIER FITZPATRICK range, and the REGIONAL INDICATOR range. */
const SKIN_LO = 0x1F3FB, SKIN_HI = 0x1F3FF, RI_LO = 0x1F1E6, RI_HI = 0x1F1FF;

/**
 * The first whole glyph of a string — one emoji, joiners and all.
 *
 * `marker` is documented as a single status glyph, and a caller who hands over a sentence gets
 * its first glyph rather than a sentence wedged into a 16px column. Splitting on code points
 * alone would be worse than not splitting: it would cut 🛠️ into a hammer plus an invisible
 * variation selector, cut a flag in half, and cut a ZWJ sequence into its parts — three ways to
 * turn one glyph into two that render as neither.
 *
 * Every test here is a numeric code-point comparison, never a character class, for the reason
 * given on {@link clean}.
 *
 * @param s the caller's marker
 * @returns the leading glyph, or '' for an empty string
 *
 * @example firstGlyph('\u2705 done');   // '✅'
 * @example firstGlyph('');              // ''
 */
function firstGlyph(s) {
  const cps = Array.from(String(s == null ? '' : s));
  if (cps.length === 0) return '';

  const at = (i) => (cps[i] === undefined ? -1 : cps[i].codePointAt(0));

  /* A flag is exactly two regional indicators and nothing else joins them, so it is its own
     case rather than a joiner rule. */
  if (at(0) >= RI_LO && at(0) <= RI_HI && at(1) >= RI_LO && at(1) <= RI_HI) return cps[0] + cps[1];

  let out = cps[0];
  let i = 1;
  while (i < cps.length) {
    const c = at(i);
    const joins = c === VS16 || c === VS15 || c === ZWJ || c === KEYCAP ||
                  (c >= SKIN_LO && c <= SKIN_HI);
    /* A code point immediately after a ZWJ belongs to the sequence whatever it is — that is what
       the joiner is for. Everything else ends the glyph. */
    if (!joins && at(i - 1) !== ZWJ) break;
    out += cps[i];
    i += 1;
  }
  return out;
}

/**
 * The summary bucket a marker counts toward.
 *
 * Mirrors `markers.ts`'s `classifyMarker`: success and failure are the two explicit lists, and
 * everything else — every running, queued and topic marker, an unknown marker, and no marker at
 * all — lands in the residual `active` bucket. That residual rule is why the three counts always
 * sum to the row count, which is the only thing that makes the tally checkable by eye.
 *
 * @param marker the row's marker, exactly as it will render
 *
 * @example bucketOf('\u2705');   // 'success'
 * @example bucketOf('');         // 'active'
 */
function bucketOf(marker) {
  if (SUCCESS.indexOf(marker) >= 0) return 'success';
  if (FAILURE.indexOf(marker) >= 0) return 'failure';
  return 'active';
}

/**
 * A marker's position in {@link MARKERS}, for sorting the icon list.
 *
 * An unrecognised marker ranks after every known one rather than throwing, so an icon list
 * holding a marker this file does not know about still sorts — last, deterministically.
 *
 * @param marker the marker string, exactly as it would render
 *
 * @example rank('\u2705');   // 0
 */
function rank(marker) {
  const i = MARKERS.indexOf(marker);
  return i === -1 ? MARKERS.length : i;
}

/* ── normalisation ───────────────────────────────────────────────────────────────────────── */

/**
 * The rows, deduped, cleaned, and with everything settled to a string.
 *
 * Duplicate ids are dropped rather than renamed, and the count comes back so the caption can
 * admit to it. Two rows sharing an id is not cosmetic here: the event this card dispatches
 * carries only the id, so a page acting on `{ id: 'x' }` would have no way to know which of the
 * two rows the viewer clicked, and would act on the wrong one half the time.
 *
 * A row with no id is a different failure and gets a different answer — a synthetic id, checked
 * against the ids already taken. Failing to name itself does not make a row less real, and
 * dropping it would lose content the caller handed over.
 *
 * @param list the caller's `rows`
 * @returns `{ rows, dupes, unknown, bare }` — dropped duplicates, rows whose marker is not in
 *   {@link MARKERS}, and rows carrying no marker at all
 *
 * @example normRows([{ id: 'a' }, { id: 'a' }]).dupes;   // 1
 * @example normRows([{ marker: '\u{1F996}' }]).unknown;  // 1 — 🦖 is not in the vocabulary
 */
function normRows(list) {
  const seen = Object.create(null);
  const rows = [];
  let dupes = 0, unknown = 0, bare = 0, auto = 0;

  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;

    let id = raw.id == null ? '' : clean(raw.id);
    if (id === '') { do { id = 'r' + auto++; } while (seen[id]); }
    if (seen[id]) { dupes += 1; continue; }
    seen[id] = true;

    const marker = firstGlyph(clean(raw.marker));
    if (marker === '') bare += 1;
    else if (MARKERS.indexOf(marker) === -1) unknown += 1;

    const href = safeHref(raw.href);
    /* An href with no tag has nothing to hang on, and dropping the link would throw away the
       only route back to the source. The id stands in — it is the row's name either way. */
    const tagRaw = raw.tag == null ? '' : clean(raw.tag);
    const tag = tagRaw === '' ? (href === '' ? '' : id) : tagRaw;

    rows.push({
      id,
      marker,
      known:  marker !== '' && MARKERS.indexOf(marker) >= 0,
      text:   raw.text == null ? '' : clean(raw.text),
      note:   raw.note == null ? '' : clean(raw.note),
      tag,
      href,
      struck: raw.struck === true,
    });
  }

  return { rows, dupes, unknown, bare };
}

/**
 * The verb list, normalised: every verb has a key, a title and something to draw.
 *
 * A verb with no `key` is dropped, because the key is the entire payload of the event this card
 * dispatches — a button firing `{ verb: '' }` is a button the page cannot act on and cannot
 * debug either.
 *
 * @param list the caller's `verbs`, possibly absent
 * @returns verbs with `key`, `title` and `icon` all settled to strings
 *
 * @example normVerbs([{ key: 'done' }])[0].title;   // 'done'
 */
function normVerbs(list) {
  const out = [];
  const seen = Object.create(null);
  for (const v of Array.isArray(list) ? list : []) {
    if (!v || typeof v !== 'object') continue;
    const key = v.key == null ? '' : clean(v.key);
    if (key === '' || seen[key]) continue;
    seen[key] = true;
    const title = v.title == null || clean(v.title) === '' ? key : clean(v.title);
    out.push({ key, title, icon: v.icon == null ? '' : clean(v.icon) });
  }
  return out;
}

/**
 * The groups, normalised, with every row assigned to at most one of them.
 *
 * Three failure modes are handled here rather than left to the browser, because all three are
 * things a caller does by accident and none of them should cost the reader a row:
 *
 *   - A `rowIds` entry naming a row that does not exist is dropped and counted. It usually means
 *     the row was filtered upstream and the group was not.
 *   - A row claimed by two groups goes to the first that claims it and is counted. Rendering it
 *     twice would double it in the tally and give the viewer two buttons that fire the same
 *     event, which looks like the card sending duplicates.
 *   - A group with no surviving rows still gets its heading emitted, hidden, because whether it
 *     is empty *now* depends on the `showStruck` setting and is therefore the browser's call.
 *
 * @param list the caller's `groups`
 * @param rows the normalised rows, whose ids the group members are checked against
 * @returns `{ groups, of, ghosts, claimed }` — the groups in declared order, a row-id-to-group
 *   map, the count of ids naming no row, and the count of rows claimed more than once
 *
 * @example normGroups([{ key: 'g', label: 'G', rowIds: ['a'] }], [{ id: 'a' }]).of.a;   // 'g'
 * @example normGroups([{ key: 'g', rowIds: ['zz'] }], [{ id: 'a' }]).ghosts;            // 1
 */
function normGroups(list, rows) {
  const known = Object.create(null);
  for (const r of rows) known[r.id] = true;

  const groups = [];
  const of = Object.create(null);
  const seenKey = Object.create(null);
  let ghosts = 0, claimed = 0, auto = 0;

  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;

    let key = raw.key == null ? '' : clean(raw.key);
    if (key === '') { do { key = 'g' + auto++; } while (seenKey[key]); }
    if (seenKey[key]) continue;
    seenKey[key] = true;

    const label = raw.label == null || clean(raw.label) === '' ? key : clean(raw.label);
    let members = 0;
    for (const rid of Array.isArray(raw.rowIds) ? raw.rowIds : []) {
      const id = rid == null ? '' : clean(rid);
      if (!known[id]) { ghosts += 1; continue; }
      if (of[id] !== undefined) { claimed += 1; continue; }
      of[id] = key;
      members += 1;
    }
    groups.push({ key, label, members });
  }

  return { groups, of, ghosts, claimed };
}

/**
 * The tally and icon list for the summary line.
 *
 * This is the checklist digest's grammar — `<counts> <noun> <icon-list>` — with the counts
 * partitioned by {@link bucketOf} and the icon list sorted count-descending then by
 * {@link rank}, exactly as `charts/digest.ts` does it. It is a re-implementation rather than a
 * call: see the note in this file's build report, but briefly, that renderer lives in another
 * repo, is TypeScript, and emits character cells — its bar is block glyphs and its icon list is
 * a two-space-joined monospace string. What travels between them is the vocabulary, not the
 * rendering.
 *
 * Rows carrying no marker are counted (in `active`, the residual bucket) but contribute no icon
 * entry, since there is no glyph to show. The three counts therefore sum to the row total and
 * the icon counts sum to the marked rows — stated here because the difference is otherwise a
 * puzzle for whoever first adds them up.
 *
 * @param rows the normalised rows
 * @returns `{ success, active, failure, total, entries }`, entries in icon-list order
 *
 * @example tally([{ marker: '\u2705' }, { marker: '\u274C' }]).entries.length;   // 2
 */
function tally(rows) {
  const counts = { success: 0, active: 0, failure: 0 };
  const byMarker = new Map();

  for (const r of rows) {
    const bucket = bucketOf(r.marker);
    counts[bucket] += 1;
    if (r.marker === '') continue;
    const seen = byMarker.get(r.marker);
    if (seen) seen.count += 1;
    else byMarker.set(r.marker, { marker: r.marker, count: 1, first: byMarker.size });
  }

  const entries = [...byMarker.values()].sort((a, b) =>
    b.count - a.count || rank(a.marker) - rank(b.marker) || a.first - b.first);

  return { ...counts, total: rows.length, entries };
}

/* ── drawn furniture ─────────────────────────────────────────────────────────────────────── */

/**
 * The verb glyphs this card can draw, by name.
 *
 * A caller's `icon` is looked up here first and rendered as escaped text otherwise, which is the
 * whole of the rule: **no caller string ever reaches `innerHTML` as markup**. `rail` takes the
 * other route and treats an icon starting with `<` as trusted SVG; that is defensible for a card
 * whose data it owns and indefensible for one rendering a ledger that arrived over the wire, so
 * this type does not offer the door. A caller wanting a shape it can name gets a drawn one; a
 * caller wanting an emoji gets an emoji; a caller wanting a `<script>` gets the text of one.
 *
 * @example VERB_ICONS.check.indexOf('<svg') === 0;   // true
 */
const VERB_ICONS = (() => {
  const draw = (d) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  return {
    check:  draw('<path d="M5 12.5l4.5 4.5L19 7"/>'),
    cross:  draw('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus:   draw('<path d="M12 5v14M5 12h14"/>'),
    minus:  draw('<path d="M5 12h14"/>'),
    up:     draw('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down:   draw('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    next:   draw('<path d="M5 12h13M12 6l6 6-6 6"/>'),
    star:   draw('<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z"/>'),
    eye:    draw('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>' +
                 '<circle cx="12" cy="12" r="2.6"/>'),
    link:   draw('<path d="M10 14a4.5 4.5 0 006.4 0l2.6-2.6a4.5 4.5 0 10-6.4-6.4L11.2 6.4"/>' +
                 '<path d="M14 10a4.5 4.5 0 00-6.4 0L5 12.6a4.5 4.5 0 106.4 6.4l1.4-1.4"/>'),
    clock:  draw('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
    pin:    draw('<path d="M12 21v-6"/><path d="M8 3h8l-1 6 3 3H6l3-3z"/>'),
    trash:  draw('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
    reply:  draw('<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 016 6v1"/>'),
    dot:    draw('<circle cx="12" cy="12" r="3.6"/>'),
  };
})();

/**
 * One verb button's inner markup: a drawn glyph for a name this card knows, escaped text
 * otherwise, and a drawn dot when the caller named nothing at all.
 *
 * @param icon the caller's `icon` string
 *
 * @example verbGlyph('check') === VERB_ICONS.check;   // true
 * @example verbGlyph('<b>x</b>');                     // '&lt;b&gt;x&lt;/b&gt;'
 */
function verbGlyph(icon) {
  if (icon === '') return VERB_ICONS.dot;
  if (Object.hasOwn(VERB_ICONS, icon)) return VERB_ICONS[icon];
  return '<span class="ck-lg-glyph">' + esc(icon) + '</span>';
}

/**
 * One row's markup.
 *
 * The marker cell is emitted even when the row has no marker, holding a hairline placeholder:
 * the column has to keep its width or every unmarked row's text starts a few pixels left of
 * every marked one, and a list that does not line up reads as two lists.
 *
 * @param r    the normalised row
 * @param grp  the group key this row belongs to, or ''
 * @param verbs the normalised verb list, shared by every row
 *
 * @example row({ id: 'a', marker: '', text: 'x', note: '', tag: '', href: '', struck: false,
 *   known: false }, '', []).indexOf('data-id="a"') >= 0;   // true
 */
function row(r, grp, verbs) {
  const mark = r.marker === ''
    ? '<span class="ck-lg-mark ck-lg-bare" aria-hidden="true"></span>'
    : '<span class="ck-lg-mark' + (r.known ? '' : ' ck-lg-odd') + '"' +
      (r.known ? '' : ' title="not in the marker vocabulary"') + '>' + esc(r.marker) + '</span>';

  const tag = r.tag === '' ? ''
    : r.href === ''
      ? '<span class="ck-lg-tag">' + esc(r.tag) + '</span>'
      : '<a class="ck-lg-tag" href="' + esc(r.href) + '" rel="noopener noreferrer" ' +
        'target="_blank">' + esc(r.tag) + '</a>';

  const note = r.note === '' ? '' : '<span class="ck-lg-note">' + esc(r.note) + '</span>';

  const acts = verbs.length === 0 ? ''
    : '<span class="ck-lg-verbs">' + verbs.map((v) =>
        '<button type="button" class="ck-lg-verb" data-verb="' + esc(v.key) + '" ' +
        'title="' + esc(v.title) + '" aria-label="' + esc(v.title) + '">' +
        verbGlyph(v.icon) + '</button>').join('') + '</span>';

  return '<div class="ck-lg-row' + (r.struck ? ' ck-lg-struck' : '') + '" ' +
         'data-id="' + esc(r.id) + '" data-grp="' + esc(grp) + '"' +
         (r.struck ? ' data-struck="1"' : '') + '>' +
         mark +
         '<span class="ck-lg-body"><span class="ck-lg-text">' + esc(r.text) + '</span>' +
         note + '</span>' +
         tag + acts +
         '</div>';
}

/* ── the browser half ────────────────────────────────────────────────────────────────────── */

/**
 * The card's browser half: hiding and reordering, never rendering.
 *
 * Written as one string wrapped in a function expression, so nothing this card defines reaches
 * the global scope — a desk can hold two ledgers, and a top-level `var` would have them sharing
 * it. Classic script throughout: `var` and `function`, no arrows, no template literals, no
 * optional chaining, because every card's script is concatenated into one inline block and one
 * modern-syntax parse error takes the whole desk down.
 *
 * @param id the card's `data-card` value, embedded as a literal
 *
 * @example main('inbox').indexOf('ck-ledger') >= 0;   // true
 */
function main(id) {
  return [
    '  CK.build(' + jsStr(id) + ', function (sec) {',
    '    var list = sec.querySelector(".ck-lg-list");',
    '    if (!list) return;',
    '',
    '    var noneEl = list.querySelector(".ck-lg-none");',
    '    var countEl = sec.querySelector(".ck-lg-count");',
    '',
    '    /* Captured once, in source order: this is the order the card falls back to when',
    '       grouping is off, and the order within every group when it is on. */',
    '    var heads = [], rows = [], kids = list.children, i;',
    '    for (i = 0; i < kids.length; i++) {',
    '      if (kids[i].className.indexOf("ck-lg-head") >= 0) heads.push(kids[i]);',
    '      else if (kids[i].className.indexOf("ck-lg-row") >= 0) rows.push(kids[i]);',
    '    }',
    '',
    '    function shown(r, cfg) {',
    '      return cfg.showStruck || r.getAttribute("data-struck") !== "1";',
    '    }',
    '',
    '    function apply(cfg) {',
    '      var k, r, frag = document.createDocumentFragment(), live = 0;',
    '',
    '      for (k = 0; k < rows.length; k++) {',
    '        r = rows[k];',
    '        r.hidden = !shown(r, cfg);',
    '        if (!r.hidden) live++;',
    '      }',
    '',
    '      /* Grouping needs at least one declared group to mean anything; with none, the',
    '         heading pass is skipped entirely rather than emitting a lone "ungrouped".',
    '         heads holds the declared groups in order with the "ungrouped" heading last, so',
    '         the last entry is handled separately below. */',
    '      var grouping = cfg.group && heads.length > 1;',
    '      var anyHead = false;',
    '      var key, mine, n;',
    '',
    '      if (grouping) {',
    '        for (k = 0; k < heads.length - 1; k++) {',
    '          key = heads[k].getAttribute("data-grp");',
    '          mine = [];',
    '          for (n = 0; n < rows.length; n++) {',
    '            if (rows[n].getAttribute("data-grp") === key && !rows[n].hidden) mine.push(rows[n]);',
    '          }',
    '          /* An empty group is hidden outright, never shown as a bare heading: a heading',
    '             with nothing under it reads as a category the reader has to go and check, and',
    '             emptiness is only knowable here because hiding struck rows can cause it. */',
    '          if (mine.length === 0) { heads[k].hidden = true; continue; }',
    '          heads[k].hidden = false;',
    '          anyHead = true;',
    '          frag.appendChild(heads[k]);',
    '          for (n = 0; n < mine.length; n++) frag.appendChild(mine[n]);',
    '        }',
    '',
    '        mine = [];',
    '        for (n = 0; n < rows.length; n++) {',
    '          if (rows[n].getAttribute("data-grp") === "" && !rows[n].hidden) mine.push(rows[n]);',
    '        }',
    '        /* The "ungrouped" heading earns its place only when a named group got one too; on',
    '           its own it would be a label meaning "everything", which is not a distinction —',
    '           and it would be the empty-heading failure wearing a different word. The rows',
    '           themselves are placed either way, so nothing is lost by withholding the label. */',
    '        var tail = heads[heads.length - 1];',
    '        if (mine.length === 0 || !anyHead) { tail.hidden = true; }',
    '        else { tail.hidden = false; frag.appendChild(tail); }',
    '        for (n = 0; n < mine.length; n++) frag.appendChild(mine[n]);',
    '      } else {',
    '        for (k = 0; k < heads.length; k++) heads[k].hidden = true;',
    '        for (k = 0; k < rows.length; k++) if (!rows[k].hidden) frag.appendChild(rows[k]);',
    '      }',
    '',
    '      /* Hidden rows stay in the DOM, at the end, so nothing is lost by a setting: turning',
    '         "show struck" back on has to bring the same elements back, not new ones. */',
    '      for (k = 0; k < rows.length; k++) if (rows[k].hidden) frag.appendChild(rows[k]);',
    '',
    '      /* One reflow: every element is moved in its new order inside a fragment, and the',
    '         fragment goes back in one call. */',
    '      list.insertBefore(frag, noneEl);',
    '      if (noneEl) noneEl.hidden = live !== 0;',
    '',
    '      if (countEl) {',
    '        countEl.textContent = live === rows.length',
    '          ? rows.length + (rows.length === 1 ? " row" : " rows")',
    '          : live + " of " + rows.length + " rows shown";',
    '      }',
    '    }',
    '',
    '    /* Delegated, so the listener count does not track the row count, and guarded by',
    '       CK.once so a <main> swap replaces the wiring rather than stacking a second copy. */',
    '    CK.once(list, "verbs", function () {',
    '      list.addEventListener("click", function (ev) {',
    '        var btn = ev.target && ev.target.closest ? ev.target.closest(".ck-lg-verb") : null;',
    '        if (!btn) return;',
    '        var tr = btn.closest(".ck-lg-row");',
    '        if (!tr) return;',
    '        /* The card says what happened and to which row, and stops. What the verb MEANS is',
    '           the page\'s business — which is why there is no allowlist of verbs in this file',
    '           and no fetch anywhere in it. Two desks can answer "snooze" differently. */',
    '        sec.dispatchEvent(new CustomEvent("ck-ledger", {',
    '          detail: { id: tr.getAttribute("data-id"), verb: btn.getAttribute("data-verb") },',
    '          bubbles: true',
    '        }));',
    '      });',
    '    });',
    '',
    '    CK.settings(sec, ' + JSON.stringify(defaults) + ', function (cfg) {',
    '      sec.classList.toggle("ck-lg-dense", !!cfg.dense);',
    '      apply(cfg);',
    '    });',
    '  });'
  ].join('\n');
}

/* ── the build ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build one ledger card.
 *
 * @param id    the card's directory name; becomes its `data-card` attribute
 * @param title the card's heading, rendered as plain text
 * @param data  `{ rows, verbs, groups, summary }`; every value in it is untrusted and escaped
 * @param ord   the card's position on the desk; non-numbers fall back to 0
 * @returns `{ json, html, css, js }`
 *
 * @example
 * build({ id: 'inbox', title: 'inbox', ord: 3, data: {
 *   rows: [{ id: 'pr-4', marker: '🔬', text: 'review the ledger card' }],
 *   verbs: [{ key: 'open', title: 'open', icon: 'link' }],
 *   summary: true
 * } }).html.indexOf('data-card="inbox"') >= 0;   // true
 */
export function build({ id, title, data, ord }) {
  const d = data && typeof data === 'object' ? data : {};

  const parsed = normRows(d.rows);
  const rows   = parsed.rows;
  const verbs  = normVerbs(d.verbs);
  const groups = normGroups(d.groups, rows);

  /* Headings are emitted in declared order with the ungrouped one last, all hidden. The browser
     half decides which of them are shown and where the rows go, because that depends on settings
     the desk stores per viewer and Node cannot see. Without the script the card is a flat list
     with no headings, which is honest — an unplaced heading would be a lie about structure. */
  const anyGrouped = rows.some((r) => groups.of[r.id] !== undefined);
  const heads = anyGrouped
    ? groups.groups.map((g) =>
        '<div class="ck-lg-head ck-h3" data-grp="' + esc(g.key) + '" hidden>' +
        esc(g.label) + '</div>')
        .concat(['<div class="ck-lg-head ck-h3" data-grp="" hidden>ungrouped</div>'])
    : [];

  const body = rows.map((r) => row(r, groups.of[r.id] === undefined ? '' : groups.of[r.id], verbs));

  /* Two different empties, and they say different things. "No rows" is a fact about the data and
     is stated once, in Node; "nothing to show" is a fact about the settings, is toggled by the
     browser, and is only emitted when there were rows to hide in the first place — otherwise an
     empty ledger would blame the viewer's settings for the caller's data. */
  const void_ = rows.length === 0
    ? '<div class="ck-lg-void">nothing to render &mdash; this ledger has no rows</div>'
    : '';
  const none = rows.length === 0 ? ''
    : '<div class="ck-lg-none" hidden>nothing to show &mdash; every row is struck</div>';

  const sum = summaryHtml(d.summary, rows);

  const notes = [];
  if (parsed.dupes)   notes.push(parsed.dupes + (parsed.dupes === 1 ? ' duplicate id dropped' : ' duplicate ids dropped'));
  if (parsed.unknown) notes.push(parsed.unknown + (parsed.unknown === 1 ? ' row carries a marker' : ' rows carry markers') + ' outside the vocabulary');
  if (parsed.bare)    notes.push(parsed.bare + (parsed.bare === 1 ? ' row has no marker' : ' rows have no marker'));
  if (groups.ghosts)  notes.push(groups.ghosts + (groups.ghosts === 1 ? ' group member names no row' : ' group members name no row'));
  if (groups.claimed) notes.push(groups.claimed + (groups.claimed === 1 ? ' row was claimed by more than one group' : ' rows were claimed by more than one group'));

  const caption = (d.caption == null ? '' : esc(clean(d.caption)) + ' ') +
    '<i class="ck-lg-count"></i>' +
    (notes.length ? ' <span class="ck-aside">' + esc(notes.join(' \u00b7 ')) + '</span>' : '');

  const html =
    '<section data-card="' + esc(id) + '" class="ck-ledger">\n' +
    '  <h2>' + esc(title) + '</h2>\n' +
    '  <button type="button" class="ck-gear" title="settings" aria-label="settings"></button>\n' +
    '  <div class="ck-set" hidden>\n' +
    '    <label for="' + esc(id) + '-dense">dense rows</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-dense" name="dense">\n' +
    '    <label for="' + esc(id) + '-showStruck">show struck</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-showStruck" name="showStruck">\n' +
    '    <label for="' + esc(id) + '-group">group</label>\n' +
    '    <input type="checkbox" id="' + esc(id) + '-group" name="group">\n' +
    '    <div class="ck-set-foot">hiding struck rows can empty a group; an empty group hides its heading too.</div>\n' +
    '  </div>\n' +
    (sum ? '  ' + sum + '\n' : '') +
    (void_ ? '  ' + void_ + '\n' : '') +
    '  <div class="ck-lg-list">\n' +
    (heads.length ? '    ' + heads.join('\n    ') + '\n' : '') +
    (body.length ? '    ' + body.join('\n    ') + '\n' : '') +
    (none ? '    ' + none + '\n' : '') +
    '  </div>\n' +
    '  <div class="ck-cap">' + caption + '</div>\n' +
    '</section>\n';

  const js = '(function () {\n' + main(id) + '\n})();\n';

  return { json: { ord: Number.isFinite(ord) ? ord : 0 }, html, css: CSS, js };
}

/**
 * The counts line, or '' when the caller did not ask for one.
 *
 * `summary` is `true` for the line with its default noun, a string for the line with that noun,
 * and absent or `false` for no line at all. A noun rather than a title because the grammar this
 * borrows reads `3/2/1 items` — the counts are the sentence and the noun is what they count.
 *
 * The line is static: it describes the ledger, not the current view, and does not change when
 * struck rows are hidden. The live figure lives in the caption instead, where "4 of 9 rows
 * shown" belongs — putting both numbers in one line would make each of them ambiguous.
 *
 * @param want the caller's `summary`
 * @param rows the normalised rows
 *
 * @example summaryHtml(true, [{ marker: '✅' }]).indexOf('1/0/0') >= 0;   // true
 * @example summaryHtml(undefined, []);                                    // ''
 */
function summaryHtml(want, rows) {
  if (want === undefined || want === null || want === false) return '';
  if (rows.length === 0) return '';

  const noun = typeof want === 'string' && clean(want) !== '' ? clean(want) : 'items';
  const t = tally(rows);
  const nums = BUCKETS.map((b) =>
    '<b class="ck-lg-b-' + b + '">' + esc(String(t[b])) + '</b>').join('<s>/</s>');

  const icons = t.entries.map((e) =>
    '<span class="ck-lg-ic"><em>' + esc(e.marker) + '</em>' + esc(String(e.count)) + '</span>'
  ).join('');

  return '<div class="ck-lg-sum">' +
         '<span class="ck-lg-tally">' + nums + '</span> ' +
         '<span class="ck-lg-noun">' + esc(noun) + '</span>' +
         (icons ? '<span class="ck-lg-icons">' + icons + '</span>' : '') +
         '</div>';
}

/* Every colour here is a desk token; there is not one literal in the file, so the theme switch
   is the only thing that has to know anything and nothing keys off `prefers-color-scheme`. The
   desk is one document open in two viewers who want different answers, and the OS only knows how
   to give both of them the same one. */
const CSS = `
  .ck-ledger { position: relative; }

  /* ── the counts line ────────────────────────────────────────────────────────────────── */

  /* The checklist digest's grammar, set as type rather than as character cells: the tally, the
     noun it counts, then one entry per marker. Tabular figures so the three counts hold their
     places when the card is rebuilt with different numbers. */
  .ck-ledger .ck-lg-sum {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px;
    margin: 10px 0 4px; padding-bottom: 8px;
    border-bottom: 1px solid var(--hairline);
    font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums;
  }
  .ck-ledger .ck-lg-tally b { font-weight: 700; }
  .ck-ledger .ck-lg-tally s { text-decoration: none; color: var(--ink-faint); margin: 0 1px; }
  .ck-ledger .ck-lg-b-success { color: var(--good); }
  .ck-ledger .ck-lg-b-active  { color: var(--ink-dim); }
  .ck-ledger .ck-lg-b-failure { color: var(--ck-s1); }
  .ck-ledger .ck-lg-noun { color: var(--ink-dim); }
  .ck-ledger .ck-lg-icons { display: flex; flex-wrap: wrap; gap: 2px 9px; color: var(--ink-faint); }
  .ck-ledger .ck-lg-ic { display: inline-flex; align-items: baseline; gap: 4px; }
  .ck-ledger .ck-lg-ic em { font-style: normal; }

  /* ── headings ───────────────────────────────────────────────────────────────────────── */

  /* .ck-h3 carries the look; this only fixes the spacing for a heading that sits inside a
     list rather than above one, and makes [hidden] actually hide — the kit's rule and the
     UA's tie on specificity, and this sheet loads later. */
  .ck-ledger .ck-lg-head { margin: 14px 0 4px; }
  .ck-ledger .ck-lg-head:first-child { margin-top: 4px; }
  .ck-ledger .ck-lg-head[hidden] { display: none; }

  /* ── rows ───────────────────────────────────────────────────────────────────────────── */

  .ck-ledger .ck-lg-list { margin-top: 8px; }

  .ck-ledger .ck-lg-row {
    display: flex; align-items: baseline; gap: 8px;
    padding: 5px 4px; border-bottom: 1px solid var(--hairline);
  }
  .ck-ledger .ck-lg-row[hidden] { display: none; }
  .ck-ledger .ck-lg-row:hover { background: var(--pill); }
  .ck-ledger.ck-lg-dense .ck-lg-row { padding: 2px 4px; gap: 6px; }

  /* A fixed marker column, kept even when a row has no marker, so the text of every row starts
     in the same place. A list that does not line up reads as two lists. */
  .ck-ledger .ck-lg-mark {
    flex: none; width: 17px; text-align: center;
    font-size: 12px; line-height: 1.5;
  }
  .ck-ledger .ck-lg-bare { border-bottom: 1px solid var(--rule); height: 1px; align-self: center; }

  /* A marker this file's vocabulary does not know still renders — dropping the row to hide our
     own staleness would be the wrong trade. The dotted rule under it is the flag, and the
     caption says how many there are. */
  .ck-ledger .ck-lg-odd { border-bottom: 1px dotted var(--ck-s2); }

  .ck-ledger .ck-lg-body { flex: 1 1 auto; min-width: 0; }
  .ck-ledger .ck-lg-text { font-size: 12.5px; line-height: 1.45; color: var(--ink); }
  .ck-ledger .ck-lg-note {
    display: block; font-size: 11px; line-height: 1.4; color: var(--ink-faint); margin-top: 1px;
  }
  .ck-ledger.ck-lg-dense .ck-lg-note { display: none; }

  .ck-ledger .ck-lg-tag {
    flex: none; font-family: var(--mono); font-size: 10px; color: var(--ink-dim);
    background: var(--pill); border: 1px solid var(--pill-edge); border-radius: 4px;
    padding: 1px 5px; text-decoration: none; white-space: nowrap;
  }
  .ck-ledger a.ck-lg-tag:hover { color: var(--accent); border-color: var(--accent); }

  /* ── struck rows ────────────────────────────────────────────────────────────────────── */

  /* Struck and dimmed, not gone: the row is the evidence of what was just done, and the verbs
     stay live so the wrong click can be answered. Only the text is struck — striking the tag
     would make a link look broken rather than done. */
  .ck-ledger .ck-lg-struck .ck-lg-text { text-decoration: line-through; }
  .ck-ledger .ck-lg-struck { opacity: .48; }
  .ck-ledger .ck-lg-struck:hover { opacity: .8; }

  /* ── verbs ──────────────────────────────────────────────────────────────────────────── */

  .ck-ledger .ck-lg-verbs { flex: none; display: flex; gap: 2px; align-self: center; }
  .ck-ledger .ck-lg-verb {
    width: 21px; height: 21px; padding: 0; line-height: 0;
    background: transparent; color: var(--ink-faint);
    border: 1px solid transparent; border-radius: 4px; cursor: pointer;
    opacity: 0; transition: opacity .12s;
  }
  .ck-ledger .ck-lg-verb svg { width: 13px; height: 13px; display: block; margin: 0 auto; }
  .ck-ledger .ck-lg-glyph { font-size: 11px; line-height: 1; display: block; }
  /* Revealed on hover or focus, never on neither: a row of buttons on every line turns a
     ledger into a control panel, and the reader came to read. */
  .ck-ledger .ck-lg-row:hover .ck-lg-verb,
  .ck-ledger .ck-lg-verb:focus-visible { opacity: 1; }
  .ck-ledger .ck-lg-verb:hover { color: var(--accent); border-color: var(--pill-edge); }
  .ck-ledger .ck-lg-verb:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }

  /* ── the two empties ────────────────────────────────────────────────────────────────── */

  .ck-ledger .ck-lg-void, .ck-ledger .ck-lg-none {
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
    padding: 14px 4px; text-align: center;
  }
  .ck-ledger .ck-lg-none[hidden] { display: none; }
  .ck-ledger .ck-lg-void { text-align: left; padding: 10px 0; }

  .ck-ledger .ck-lg-count { color: var(--ink-faint); }

  @media (prefers-reduced-motion: reduce) {
    /* The verb fade is decoration; hover and focus still reveal them instantly. */
    .ck-ledger .ck-lg-verb { transition: none; }
  }
`;
