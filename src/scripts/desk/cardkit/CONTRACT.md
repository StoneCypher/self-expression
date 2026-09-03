# The card type contract

One file per type in `types/`, an ES module, no dependencies. Read this before writing one, and
before changing one someone else wrote.

This file exists because six types were written in parallel by six agents and `meta.shape` came back
in two different shapes — a prose string from some, an object keyed by setting name from others.
That is exactly the drift a catalogue is supposed to prevent, and it appeared within the first hour.

## Exports

```js
export const meta = {
  name:     'candles',                       // the type's id, matching the filename
  summary:  'OHLC candlesticks with a volume lane.',   // ONE line, sentence case, ends in a period
  shape:    '{ symbol, bars: [{ t, o, h, l, c, v }], currency }',  // a STRING: the data literal
  category: 'evolution',                     // exactly one key from categories.mjs
  defaults: { ma: 0, logScale: false },      // an OBJECT: every setting with its fallback
};

export function build({ id, title, data, ord }) {
  return { json, html, css, js };            // four strings; `json` may be an object
}
```

`shape` is a **string** — the shape of `data`, written the way you would write it in source. It is
for a human choosing a type, so it must read at a glance.

`defaults` is an **object** — every setting the card understands, with its fallback. It is for a
machine: the panel's fields are checked against it in both directions, and a validator can inspect
a type without building it.

A type with no settings omits `defaults` and emits no gear.

**`category` is required and there is exactly one.** The keys live in `categories.mjs` and name the
QUESTION a card answers, not the shape it draws — a reader arrives at a catalogue holding a question,
not a silhouette. Zero categories is not allowed because an uncategorised type is invisible in the
gallery, which is the surface a newcomer uses to discover what exists; several is not allowed because
a type that genuinely belongs in two is usually two types wearing one name, and the constraint is
what surfaces that.

## Cards inside cards

A type may hold other cards. It declares `contains: true` in its `meta`, which is what lets the
checks relax the one-section rule for it and nothing else — a type emitting two sections is nearly
always a stray tag, so the rule keeps its teeth for everyone.

Build children with `nest(mod, parentId, slot, spec)` from `newcard.mjs`. It composes the id as
`parent--slot`, which is what stops two children of the same type claiming one `data-card`: `CK.card`
resolves by `querySelector`, so a repeat means the first paints twice and the second is markup
nobody ever draws into. Nest the child's `html` inside your section; concatenate its `css` and `js`
at the top level exactly as a standalone card's would be.

Nothing else about a child is special, and that is the property worth keeping — every type is
nestable without knowing it is. The desk's per-card swap diffs by `data-card`, so a nested child
repaints independently of its parent for free.

**`meta.defaults` must be reachable from `meta`.** Six types independently wrote
`export const defaults = {...}` as a separate binding and never put it on `meta`, so
`meta.defaults` was `undefined` and every validator failed them — and because `meta` was declared
above it, `meta` could not have referenced it anyway without a temporal-dead-zone error. A separate
export is fine and often nicer to read; declare it FIRST and spread it, so there is one written
source and two places to read it:

```js
export const defaults = { limit: 200, live: false };
export const meta = { name: 'audit', summary: '…', shape: '{ url, limit }', defaults: { ...defaults } };
```

## What `build` returns

| key | what |
|---|---|
| `json` | `{ ord }` at minimum; becomes `card.json` |
| `html` | exactly one `<section data-card="${id}" class="ck-<type>">`; becomes `card.html` |
| `css`  | every selector scoped under `.ck-<type>`; becomes `card.css` |
| `js`   | a browser classic script, or `''`; becomes `card.js` |

## The rules that are not negotiable

1. **Both themes.** Tokens only: `--ink`, `--ink-dim`, `--ink-faint`, `--ground`, `--rule`,
   `--hairline`, `--accent`, `--well`, `--pill`, `--pill-edge`, `--good`, `--ui`, `--disp`,
   `--mono`, `--ck-grid`, `--ck-s1`..`--ck-s8`. A literal colour is a bug in one of the two themes.
   If a type genuinely needs its own colour, define it on bare `:root` and override it under
   `:root[data-theme="light"]` — never anywhere else.
2. **Never `prefers-color-scheme`.** The desk is one document open in two viewers that want
   different answers; the OS gives both the same answer.
3. **Classic script in `js`.** `var`, `function`. No arrow functions, no `const`/`let`, no optional
   chaining, no template literals. It is concatenated with every other card's script into one
   inline block, so one modern-syntax parse error takes the whole desk down — which has happened.
4. **Idempotent.** The desk swaps `<main>` and replays every builder. Use `CK.once` for listeners
   and `CK.timer` for intervals. `CK.once` CANNOT guard a timer across a swap: it keys off the
   element, and a swap hands you a new one with an empty dataset.
5. **All data is untrusted.** Escape it or set it with `textContent`. Links: allowlist `http:` and
   `https:` by parsing, never blacklist by matching. Re-vet anything read back from `localStorage` —
   it is a text file the viewer can edit.
6. **No control characters in source.** Five separate incidents in one evening, so the mechanism is
   worth writing down rather than restating as care. A literal control character is invisible when
   written, **rendered as a space by the Read tool** so it is invisible on readback too, legal to
   the JavaScript parser, and survives `node --check` — a NUL inside a string is valid JS. Edit then
   fails to match the line, because the file and your copy of it genuinely differ. The only things
   that notice are grep calling the file binary, hours later, or a deliberate byte scan.

   Writing the escape is necessary and NOT sufficient. There is a second sub-mechanism: an escape
   written correctly can be decoded one step too early during emission, so an intended character
   class lands on disk holding raw control bytes and still looks like a plausible regex. That is how
   the sixth incident happened, to an agent that had been warned — and the seventh happened to THIS
   PARAGRAPH, which held a raw NUL where it meant to show the escape for one.

   So: **avoid the literal in every form.** Compare code points numerically
   (`s.charCodeAt(i) < 32`) instead of writing a character class, and use `String.fromCharCode(0)`
   instead of a quoted NUL. Neither can be mistyped or mis-decoded, because neither contains the
   character at all. Where a literal is genuinely unavoidable, write the escape. And prefer
   *printable* separators: a join separator only has to not collide, and a visible one is checkable
   in a way an invisible one never is.
7. **No library.** The CSP is `script-src 'self'`. Hand-draw it; that is the job, not an obstacle.
   The exception is a module the deck server itself serves — same origin is `'self'`, so a vendored
   bundle under `/vendor/` is legal where a CDN is not. It is an exception, not a loophole: it costs
   a dependency, a build with browser export conditions, and a `<script type="module">` in the page
   shell, because a card's `js` is concatenated into one classic inline block and cannot import.

## State machines are not hand-drawn

**Any FSM or flowchart is an `<fsl-instance>` workbench.** Never a hand-written renderer, and never a
bare `<fsl-viz>` either — `layout` decides which panels appear, and a raw viz throws away the
toolbar, actions, history and footer for nothing. `layout="lr"` with the editor on when the word was
*state machine*; `layout="viewer"` when the word was *flowchart*. `layout` defaults to `''`, which
is stacked, so naming it is load-bearing.

**Fourteen static slots** — `title toolbar viz editor actions info-panel history data-inspector
hook-log effective-properties simulation stochastic export footer` — plus a *dynamic*
`state-<current>` slot that re-targets on every transition and cannot be filled ahead of time. Fill
all fourteen. An unslotted child is not merely invisible: the source resolver strips `[slot]`
elements and `fsl-*` tags from the host before reading light-DOM text, so a child that forgot its
`slot` **becomes FSL source**, collides with the `fsl` attribute, and throws at connect.

Slotting a panel does not make it appear — `panelMode` defaults to `default`, which hides everything
except viz and editor. Use `panel-mode="request"` plus `requestedPanels`, which leaves the toolbar's
own toggles working; `show` wins but locks them.

`theme` is a **mode** (`system | light | dark`, defaulting to light), not a palette — the palette is
`themeName` against a `themes` registry. **`theme="system"` is `prefers-color-scheme` wearing another
word and is forbidden here.** Do not set `theme` on the slotted `<fsl-editor>`: the host overwrites
it from its own variant. Follow the desk's theme by writing the *attribute* on the instance, so
there is no pre-upgrade race.

The instance needs an explicit height or every split pane collapses to zero. `<fsl-editor>` reads its
`fsl` **property**, never light-DOM text, and seeds from the host exactly once — a later `fsl` write
rebuilds the machine and the graph but leaves the editor showing the old document, so anything that
re-seeds must set both, and must wait on `updateComplete` because a property write before the first
render is accepted and never compiled. **Never give the instance an `id` or a `uhash`**: it attaches
a permalink sync that then encodes the machine into `location.hash` on every edit, and two cards
would fight over the fragment.

This paragraph exists because rule 7 above caused the failure it now excepts. Told to hand-draw and
not told about the workbench, eight separate builds have hand-written an FSL visualiser — each one
correct against the brief it was given. A constraint that lives only in the coordinator's head is a
constraint the builder cannot obey, so it lives here, in the file every builder reads.

A hand-written deterministic layout engine is still worth having, but as a layout engine and not as a
card: graphviz relayouts wholesale on any edit, so a state jumps across the pane when you add an
unrelated transition. Identity-stable coordinates are the thing it cannot do.

## The build-time guard, and how to write it correctly

Five types independently shipped a broken script the same way: a backtick inside a comment. Any
function sent to the browser through `Function.prototype.toString()` carries its comments with it,
so a backtick around a word in a doc comment closes the surrounding template literal early. The
parse error does not stay local — the whole deck's `js` is one inline block, so it blanks every card
on the page.

So every type builds its `js` by concatenation and **throws during `build`** if the result contains
a backtick, `=>`, `?.`, `const`, `let`, or a control character. Refer to the backtick as
`String.fromCharCode(96)` rather than writing it.

**Blank comments and string bodies before scanning for keywords.** A raw scan for `const` / `let` /
`class` false-positives on English prose — one card was refused because a comment said "the class is
what CSS reads". Preserve offsets while blanking so the reported position still means something.
Keep the raw scan for backtick, arrow and optional chaining, which cannot appear innocently.
A guard that cries wolf is a guard that gets deleted.

Run `node --check` (or `vm.Script`) over **your own module source** too, not only over the emitted
`js`. Two of the five failures were in the module itself, where the emitted-code check cannot reach.

## Computing geometry in Node

A type may do its arithmetic at build time and emit a display list, so the browser only paints.
When it does, **load `kit.js` into a `node:vm` context and use the real `CK`** rather than
reimplementing `scale`, `ticks` or `hue` in the module. A private copy is a second source of truth,
and it drifts silently — the gridlines stop matching the axis and nothing errors. Found and done
this way by the chart/graph build; adopt it.

The same argument applies to any browser helper a type both ships and tests: emit it via
`Function.prototype.toString()` so the thing tested is textually the thing that runs. A Node-shaped
twin of a browser function will eventually disagree with it.

## Verification

Every type ships with a throwaway node script that asserts the above, is run, and is then deleted.
Static checks are necessary and not sufficient — they can tell you a clock's script parses, not that
the clock tells the time. Where behaviour is checkable, execute the emitted script against a stub.

Do not open a browser to look at output. Render it in Node.

**A Node harness must also define `DESK` as a BARE global**, not only `window.DESK`. `CK.build`
reads it unqualified after guarding on `window.DESK`, which is the same object in a browser and two
different lookups in a `vm` context. A stub with only `window.DESK` silently registers nothing, and
every card in the harness paints an empty section while every assertion about the markup still
passes. Cost one agent most of a section before it was found.

**A Node harness must define both `localStorage` and `window.localStorage`.** `CK.settings` reaches
for the bare global, correct in a browser; a harness that defines only `window.localStorage` sends
every write into `CK.settings`'s own `try/catch`, so nothing persists and every settings assertion
passes for the wrong reason. Cost one agent a debug cycle.

**Mutation-test the suite when it passes first time.** One agent did not trust a clean 201/201, broke
its own card eight ways, and found that seven breaks were caught and the eighth was not — nothing
asserted that replaying the builder REPAINTS rather than appending a second copy of every row. A
suite that has never failed has not been shown to work.
