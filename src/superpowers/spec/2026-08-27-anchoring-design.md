# Anchoring — design

2026-08-27 · refs issue #18 ("Anchoring: commentary bound to a location instead of
floating in prose")

**Status: proposal, awaiting human review.** This is a spec, not an implementation.
Nothing below lands until it is approved; the implementation checklist at the end is the
work that follows approval. This spec must not close #18 — implementation does.

## Goal

Commentary currently floats in prose: a reservation about line 40 is a paragraph that
*says* "line 40", and the reader goes and finds it. That is a citation, not an
annotation. This spec designs the annotation: an expression entry that carries a
machine-readable **anchor** — a pointer to the thing the note is about — plus the
rendering that makes it read as attached, the resolution rules for when the target
moves or vanishes, and the batch surface for the issue's core case: **many short notes
bound to many locations**, instead of prose that mentions locations.

Two target families, per the issue:

- **Onto files** — partially solved (a markdown `path#L42` link renders clickable in
  the VS Code surface); what is missing is the many-notes-many-locations inverse, and
  survival of the note when the line moves.
- **Onto the human's own messages** — no mechanism at all today. "This clause reads
  three ways" attached to the clause, instead of quoted back inside a paragraph. The
  shape is #15's: **a notification, not a question** — it marks an ambiguity without
  blocking on it, and the human resolves it whenever, or never.

## Non-goals

- **No overlay.** No host in the tri-host set can retro-edit an earlier message in the
  transcript; every design below is quote-plus-marker, chosen deliberately rather than
  as a fallback (§1).
- **No new channel.** Anchoring is a *qualifier* on existing channels (dissent, need,
  confidence, conflict, idea, divergence), exactly as typed silence is a qualifier in
  the channel-extensions design. An anchored dissent is still a dissent.
- **No diagram or chart semantics.** #19 owns structure-drawing; the only contact here
  is the ability to anchor a note *to* an already-rendered chart element (§2), which
  consumes the stable `seriesKey` interface (#27) and adds nothing to the renderers.
- **No cross-session inbox.** An anchor on a message from a previous session is
  representable (the record is durable) but delivery of ripened commentary is #43's
  problem, not this one's.
- **No salience interaction.** The channel-extensions ⭑ marks a sentence of the
  model's *own* main prose and is deliberately unrecorded; anchors point at things
  *outside* the current response and are recorded. Different mechanisms; neither
  subsumes the other.

&nbsp;

## 1. What can be addressed, and what the medium permits

The transcript is append-only in every host (Claude Code terminal, VS Code extension,
Codex, Gemini). Nothing can be drawn *on* an earlier message; the only universal
rendering primitive is new text that **quotes and marks**. The VS Code surface adds one
progressive enhancement — markdown links of the form `[store.ts:141](src/ts/channels/store.ts#L141)`
open the file at the line — and the terminal degrades the same link to readable text.
So the design floor is quote-plus-marker everywhere, with file links as enhancement;
whether other hosts linkify is a verification item in the checklist, not an assumption.

Five target kinds are addressable with what the system already observes:

| kind | target grammar | who observes it | stability |
|---|---|---|---|
| `file` | repo-relative path + line span | model reads the file | **drifts** — lines move, content edits, files vanish |
| `prompt` | `prompt_id` + quoted span | hook observes `prompt_id` and `user_input` | **immutable** — a sent message never changes; only *access* degrades |
| `reply` | `prompt_id` + quoted span of the model's own output | self-reported (no hook sees responses) | immutable but unverifiable at write |
| `checklist` | `series_key` + item label | entries store (#27's stable key) | item labels rename; series persists |
| `entry` | entry `id` | entries store | permanent (rows are never deleted) |

Chart elements need no sixth kind: a point in a logged series is `checklist` /
`series_key` plus an index carried in the span field (§3 grammar), because the only
charts with addressable identity are the ones backed by `series_key` history —
everything else is rendered from caller-supplied data and has no durable referent to
point at.

`prompt` is the interesting kind and the reason this issue exists. Its stability story
is the inverse of `file`: a human message, once sent, is frozen — a quote of it can
never *drift* — but it can scroll away, be compacted out of context, or belong to a
prior session. So `file` anchors need drift *detection* and `prompt` anchors need
graceful rendering when the target is merely *far away* (§4).

`reply` — anchoring onto the model's own earlier output — is included because
self-correction wants it ("the third bullet in my last summary was wrong"), but it is
flagged as inherently self-reported: no hook observes response text, so the quote is an
assertion, not an observation. The record marks this honestly by kind rather than
pretending parity with `prompt`.

&nbsp;

## 2. Representation: anchor fields on the entry, not an anchors table

An anchor is five nullable columns on `entries`, in the exact pattern typed silence
uses — a qualifier any channel can carry:

- `anchor_kind TEXT` with `check('anchor_kind', ANCHOR_KINDS)` — new closed vocabulary
  `ANCHOR_KINDS = ['file', 'prompt', 'reply', 'checklist', 'entry']`.
- `anchor_target TEXT` — the per-kind target: repo-relative path, `prompt_id`,
  `series_key`, or entry id as text.
- `anchor_span TEXT` — per-kind position grammar (below). Nullable even when anchored:
  a note on a whole file or a whole message needs no span.
- `anchor_quote TEXT` — verbatim excerpt of the anchored content, ≤ 120 characters,
  whitespace-collapsed. Privacy-gated for `prompt` (§5).
- `anchor_hash TEXT` — 16 hex chars of SHA-256 over the normalized quote. Stored even
  when the quote itself is suppressed, so drift detection and aggregation survive
  privacy suppression without carrying a single word of anyone's text (§5).

**Span grammar**, per kind, documented in the vocabulary DocBlock and enforced by
validation:

- `file` — `L40` or `L40-52`, 1-based, the GitHub fragment convention already in use.
- `prompt` / `reply` — an occurrence ordinal `#2` when the quote appears more than
  once in the target message; omitted means first occurrence. Occurrence ordinals
  beat character offsets because offsets break under any whitespace renormalization
  and are unreadable in the record, while a quote plus ordinal is self-describing and
  human-checkable.
- `checklist` — omitted (the quote carries the item label), or `@3` for the third
  point of the series' percent history when anchoring a chart element.
- `entry` — always omitted; the id is exact.

**One note, one row; many notes, many rows.** A note that genuinely concerns two
locations is two rows sharing text — acceptable, because in five weeks of logged use
the many-notes-one-location and one-note-one-location shapes dominate and the
many-locations-one-note shape is speculative. This keeps the design's central property
intact: one table, one row per expression, grouping by `prompt_id`, no parent-child
links invented where none exist.

Resolution status (`fresh` / `moved` / `orphaned`, §4) is **computed at read time and
never stored** — it is a fact about the present state of the target, not about the
entry, and storing it would rot the moment the file changed again.

New index: `idx_entries_anchor ON entries(anchor_kind, anchor_target)` — the "every
note ever attached to this file / this message / this series" query is the one
anchoring exists to answer.

### Alternatives rejected

- **A separate `anchors` table** (entry_id FK, many anchors per entry). More machinery
  for a shape the data does not exhibit, and it would make anchored expressions a
  different *kind* of row — the same argument that rejected a forecast-resolution
  table in the channel-extensions design. If the many-locations-one-note shape ever
  materializes in the log, a join table can be added then, migrating the columns into
  it; the reverse migration would be worse.
- **An `annotation` channel.** An anchored dissent is a dissent; a channel would force
  choosing between recording *what kind of thing was said* and *that it was attached*,
  and every real example in the issue is an existing channel plus a location.
- **Overloading `corrects_id` for `entry` anchors.** `corrects_id` means retraction —
  "this replaces that". An anchored comment on an earlier entry means "this is about
  that", with the earlier entry still standing. Merging them would poison every
  retraction analysis. The two coexist: an entry resolving an anchored ambiguity note
  carries `corrects_id` → the note, which is the existing linkage doing its existing
  job (§6).
- **Character offsets for prompt spans.** See span grammar above: unreadable,
  fragile, and privacy-hostile (an offset is only meaningful against retained text).
- **Pinning file anchors to a commit SHA.** A commit pin answers "what did the file
  say then" — which git already answers — not "where is this line now", which is the
  question an annotation reader actually has. Content fingerprinting (§4) answers the
  real question; the ambient `git_branch` column already records enough context to
  reconstruct the rest.

&nbsp;

## 3. Recording surface: `express` grows anchor arguments; `annotate` does the batch

### `express`

Four new optional arguments, mechanical: `anchorKind` (enum over `ANCHOR_KINDS`),
`anchorTarget`, `anchorSpan`, `anchorQuote`. `anchor_hash` is **derived server-side**
from the normalized quote, never accepted — a caller-supplied hash could disagree with
its own quote, and the whole point of the hash is that it is a function of the content.

Cross-field validation (extending `entries.validate`'s new cross-field section from
the channel-extensions design):

- any anchor field without `anchorKind` → rejected, message names the rule;
- `anchorKind` without `anchorTarget` → rejected;
- `anchorQuote` absent on `prompt` / `reply` kinds → rejected (an unquoted quote-anchor
  is unresolvable by construction; `file` may anchor by span alone, messages may not);
- `anchorSpan` grammar checked per kind (`L\d+(-\d+)?` for file, `#\d+` for
  prompt/reply, `@\d+` or absent for checklist, absent for entry);
- at the tool layer, where the store is available: an `entry` anchor whose target id
  does not exist → rejected with the highest existing id named; a `checklist` anchor
  whose `series_key` has no rows → rejected naming the known keys.

The tool resolves `prompt`-kind targets the same way it resolves `session`: **omit
`anchorTarget` and the hook-observed `prompt_id` of the message being replied to is
adopted.** The common case — annotating the message you are answering — therefore
requires only the quote. Naming an earlier `prompt_id` explicitly stays possible for
retrospective annotation.

### `annotate` — the batch tool

The issue's center of gravity is "many short notes bound to many locations", and one
`express` call per note makes a ten-note review cost ten tool calls. New MCP tool
`annotate`, in `src/ts/mcp/tools.ts` beside `express`:

- input: `notes: { channel, text, face?, anchorKind, anchorTarget?, anchorSpan?,
  anchorQuote? }[]` (1–25), plus the same omittable `session` as `express`;
- each note validates and records exactly as an `express` call would — one row each,
  same hook-context adoption, same privacy gates; **all-or-nothing**: one invalid note
  rejects the batch naming the note index and the problem, because a half-recorded
  review is worse than a rejected one;
- returns the recorded ids plus the rendered annotation block (§4), so the model can
  paste the canonical rendering instead of imitating it — the same
  prevent-the-error-class argument that motivated the chart renderers.

`recall`'s `recentEntries` SELECT widens to include the five anchor columns, so "what
did I recently annotate, and was it answered" is answerable without raw SQL.

### Alternatives rejected

- **Only the batch tool, no `express` arguments.** A single anchored dissent
  mid-response is the one-note case and should not require array packaging; both
  surfaces write the identical row shape, so the cost is schema description, not
  machinery.
- **A `resolve_anchor` tool.** Resolution is a read-time computation (§4) surfaced
  through `annotate`'s echo and future report tooling; a dedicated tool would be a
  second way to do what `recall` plus rendering already does.
- **Free-form anchor syntax inside `text`** (e.g. leading `@file.ts:40`). The
  unqueryable-prose failure yet again — the stems promotion and the series-key fix
  both exist because convention-in-text rots. Structure goes in columns.

&nbsp;

## 4. Rendering, and degradation when the anchor drifts

### The anchored line

An anchored expression renders as its channel's existing diff line with an **anchor
segment** spliced between the keyword and the note: ⚓ then the target, then the quote
in backticks, then `»`, then the note, ending — like every channel line — with the
feeling face.

```diff
! dissent: ⚓ src/ts/channels/store.ts:141 `readConfig(store, key)` » null for unset and for empty; callers can't tell which 😕
- need: ⚓ your message `ship it when ready` » "ready" reads three ways: tests green, PR approved, or deployed 😟
! diverged: ⚓ #212 » that entry claimed the gate was exact; it wasn't for mid signatures 😬
```

Target rendering per kind: `file` renders `path:line`, and in markdown-capable
surfaces as the clickable `[path:line](path#L40)` link; `prompt` renders as the words
`your message` (or `your message (2 turns ago)` when not the current one); `reply`
as `my reply`; `checklist` as the series title; `entry` as `#id`.

### The annotation block

When `annotate` records two or more notes, the canonical rendering is a block keyed by
target — the code-review shape the issue points at — with one quote-anchored line per
note, grouped and ordered by target then position:

```text
⚓ src/ts/channels/store.ts
   L141  `readConfig(store, key)`   » null for unset and for empty 😕
   L162  `writeConfig` stamps utc   » local timestamp never updated 🤨

⚓ your message
   `ship it when ready`       » "ready" reads three ways; assuming tests-green 🤔
   `the old config format`    » two old formats exist; assuming v1 😬
```

Alignment pads quotes to the longest in the group, capped; quotes over the cap
truncate with `…`. Each line still records as its own row with its own channel — the
block is presentation, the rows are the record.

The `annotations`-payload rendering the issue sketches is exactly this block; it lands
as a pure renderer `renderAnnotations(notes)` in `src/ts/charts/` (data in, exact
string out, `RangeError` naming the accepted domain — the established renderer
contract), which both the `annotate` tool and any future report call.

### The degradation ladder

Resolution is computed whenever an anchor is re-rendered or recalled, by a pure
resolver in a new `src/ts/channels/anchors.ts`: `resolveFileAnchor(anchor, fileLines)`
takes the anchor fields plus the target's *current* content as an argument — the tool
layer does the file read, the resolver stays pure and testable. Three verdicts:

  1️⃣ **fresh** — the normalized content at the recorded span still hashes to
  `anchor_hash`. Render unchanged.

  2️⃣ **moved** — the hash no longer matches at the recorded span, but exactly one
  line (or contiguous span) elsewhere in the file matches it. Render at the new
  location, marked: `L141→L158 (moved)`. Zero matches at the span with *multiple*
  matches elsewhere is ambiguous and degrades to orphaned rather than guessing —
  resolving on a guess is worse than not resolving.

  3️⃣ **orphaned** — the content is gone, or the file is. The quote is now the whole
  anchor: render quote-plus-note with the target struck through in prose,
  `⚓ src/old.ts (gone) \`the quoted line\` » …`. An orphaned annotation loses its
  address, never its content — which is precisely what floating prose gets right
  today, so orphaning degrades *to* today's behavior, not below it.

`prompt` and `reply` anchors never move; their ladder is `fresh` (the target turn is
in the current session) versus `distant` (an earlier session — rendered with the
session noted, quote carrying the weight). `checklist` anchors go orphaned when the
label no longer appears in the series' latest snapshot; `entry` anchors are always
fresh.

This is the mechanism code review platforms converged on — position + content
fingerprint, re-resolved against the current state, comments surviving as "outdated"
when resolution fails — applied to a medium that cannot draw in the margin, so the
margin is simulated with the quote.

### Ambiguity marks are notifications

The load-bearing consequence of the issue's "why it matters" section, stated as a
skill rule: an anchored ambiguity note (typically `dissent` or `confidence` with
`inferred`/`guessed`) **does not block and does not ask**. The model states which
reading it took, anchors the mark to the clause, and proceeds. The human answers by
quoting the anchor ref back whenever they choose — and the model records the outcome
as a new entry with `corrects_id` pointing at the mark, closing the loop in the
existing linkage. A `need` stays what it is: blocking, an answer owed. Anchoring
changes where commentary sits, not the contract of any channel.

### Alternatives rejected

- **Markdown footnote syntax** (`[^1]`) as the rendering. Host support is wildly
  inconsistent, and footnotes detach the note from the quote — the exact floating this
  issue exists to end.
- **Storing the resolution verdict.** Derivable data that rots on the next edit; the
  same argument that kept decoration glyphs out of storage.
- **Fuzzy-matching moved lines** (edit distance under a threshold). Silent
  wrong-attachment is the worst failure this system can have — a note confidently
  pinned to the wrong line is worse than an orphan. Exact-normalized-match only;
  a miss degrades honestly.
- **Blockquote-based rendering** of the quoted span. Blockquotes italicize in these
  surfaces and are already ruled out for number-square lists for that reason; backtick
  quoting inside the diff-line uniform keeps the established channel look.

&nbsp;

## 5. Privacy and aggregation

`anchor_quote` on a `prompt` anchor stores the human's own words verbatim — the most
sensitive field this plugin has ever proposed to hold. It follows the established
write-time redaction doctrine, never captured-then-hidden:

- New flag in `PrivacyFlags`: `storeQuotes`, key `privacy.store_quotes`, default
  recording, suppressed only by the exact string `'false'` — identical semantics to
  `privacy.store_cwd`. Coordinate the key name with #30's ledger.
- When suppressed: `anchor_quote` is dropped at write for `prompt`-kind anchors (the
  human's words) — `file`, `reply`, `checklist`, and `entry` quotes are the model's or
  the repo's own text and record regardless. `anchor_hash` **still records**: sixteen
  hex characters of a one-way digest carry drift-detection and same-target grouping
  without carrying language. A suppressed-quote prompt anchor renders from the
  rendered response itself at write time (the quote appeared in the transcript once)
  and degrades to hash-only in later recall — a documented, deliberate loss.
- Aggregation: the structured-aggregation design (#31) excludes free text from any
  public rollup; `anchor_quote` is free text and is excluded with it. `anchor_kind`
  and `anchor_hash` are structured and safe — "what fraction of dissents are anchored,
  onto what kinds" is exactly the kind of question aggregation should answer, and it
  needs no words to answer it.

&nbsp;

## 6. Interaction with siblings

- **Channel extensions (#42, spec merged).** Anchoring adds one vocabulary
  (`ANCHOR_KINDS`), five columns, one index. All additive-nullable, but the
  `anchor_kind` CHECK means the same baked-constraint problem #42's migration section
  solves — so this rides the same `migrate.ts` machinery: whichever implementation
  lands second adds a schema-version step (v2→v3, or folds into v1→v2 if approved
  together). Nothing here alters #42's columns or vocabularies. Anchored self-state
  lines keep their decorations: `! 🤔 dissent: ⚓ …` composes; the anchor segment
  follows the keyword, the decoration precedes it.
- **#15 / conflict.** A conflict line gains the obvious upgrade for free: anchor each
  side of the contradiction (`anchorKind: 'prompt'` at the two clauses, two rows) so
  "your instructions contradict" points at *which words*.
- **#19 diagrams.** No contact beyond the `checklist`-kind chart-point grammar (§3);
  if diagrams later acquire durable identity (a named FSL state, say), a new anchor
  kind can be added to the vocabulary without schema change beyond the CHECK, which
  by then is migration-managed.
- **#27 / PR #54.** The stable `seriesKey` is precisely what makes `checklist`
  anchors possible; title-keyed series would have orphaned every anchor on rename.
- **#43 self-initiated speech.** An orphaned or long-unanswered anchor is a plausible
  ripening trigger someday; the queryable columns are the interface, and nothing here
  depends on #43 in either direction.
- **#31 structured aggregation** — §5.
- **#30 config surface** — one new key, `privacy.store_quotes`; no toggle otherwise:
  like typed silence, anchoring is a qualifier on entries being written anyway, and a
  switch to turn *attachment* off while the commentary still flows would only make the
  record vaguer.

&nbsp;

## 7. Skill changes (`skills/self-expression/SKILL.md`)

One pass, after code lands:

- the anchored-line syntax: ⚓ segment between keyword and note; per-kind target
  rendering; quote in backticks; the existing end-with-feeling-face rule unchanged;
- the annotation block: when three or more notes share a turn, prefer one `annotate`
  call and paste its returned block verbatim;
- the ambiguity-mark rule (§4): anchored marks are notifications; state the reading
  taken; never convert a genuine blocker into a mark — `need` still exists;
- quoting discipline: quote the *shortest span that is unambiguous*, ≤ 120 chars;
  prefer extending the quote over adding an occurrence ordinal when both would work;
- budget: anchoring has none of its own — each note is budgeted by its channel's
  existing scarcity rules. Attachment is free; commentary never was.

&nbsp;

## 8. Testing

- **Vocabulary spec**: `ANCHOR_KINDS` membership, lowercase-ASCII invariant, exact
  contents pinned.
- **Entries specs**: the cross-field accept/reject matrix of §3 (kind × target ×
  span-grammar × quote-requirement), hash derivation pinned against known SHA-256
  vectors, multi-problem reporting preserved.
- **Resolver specs** (`anchors.spec.ts`): fresh/moved/orphaned verdicts at the
  boundaries — match at span, single match elsewhere, multiple matches (degrades to
  orphaned), empty file, missing file, span past EOF; occurrence-ordinal resolution
  for prompt quotes.
- **Renderer specs**: exact-string expectations for the anchored line per kind and
  the grouped block — alignment, truncation at the quote cap, moved and orphaned
  renderings.
- **Stochastic** (fast-check): resolver never returns `moved` unless exactly one
  match exists; normalization idempotent; hash equal iff normalized quotes equal;
  renderer block line count equals note count plus group headers; validator and the
  rebuilt table's CHECK agree on `anchor_kind` (the two-layer no-drift property).
- **Tool specs**: `express` with anchors through `buildServer`; `annotate`
  all-or-nothing rejection naming the bad index; prompt-target adoption from hook
  context; `privacy.store_quotes = 'false'` drops the prompt quote, keeps the hash,
  and leaves file quotes untouched.

&nbsp;

## Implementation checklist (follows approval)

1. `src/ts/channels/vocabulary.ts` — `ANCHOR_KINDS` + type, span-grammar DocBlock;
   update `vocabulary.spec.ts`.
2. `src/ts/channels/schema.ts` — five anchor columns with the `anchor_kind` CHECK,
   `idx_entries_anchor`; schema-version step per the #42 migration machinery
   (coordinate which lands first); update `schema.spec.ts`.
3. `src/ts/channels/anchors.ts` (new) — normalization, hashing, pure resolvers, span
   grammar parse/validate; `anchors.spec.ts` + stochastic.
4. `src/ts/channels/entries.ts` — `EntryInput` anchor fields, cross-field validation,
   server-side hash derivation, insert wiring, widen `recentEntries`; update
   `entries.spec.ts`.
5. `src/ts/channels/privacy.ts` — `storeQuotes` flag; update `privacy.spec.ts`.
6. `src/ts/charts/` — `renderAnnotations` pure renderer + specs, exported via
   `charts/index.ts`.
7. `src/ts/mcp/tools.ts` — `express` anchor arguments, `annotate` tool, tool-layer
   target-existence checks, prompt-target adoption; update tool specs.
8. Verify link rendering across hosts (VS Code extension, terminal, Codex, Gemini):
   does `[path:line](path#L40)` linkify, and does ⚓ render everywhere; adjust the
   per-kind target rendering table if a host degrades badly.
9. `skills/self-expression/SKILL.md` — the one-pass update of §7.
10. `base_README.md` (README is generated) — anchor fields, `annotate` tool, privacy
    key.
11. `src/doc_md/plugin-layout.md` — note `channels/anchors.ts` beside the channels
    entry.
12. Full build green (`npm run build`); PR closes #18.

Sequencing: 1–2 first (everything depends on vocabulary and DDL), then 3–4 together
(resolution is meaningless without the fields), 5 alongside, then 6–7 in parallel,
then 8 before 9 (the skill should teach what hosts actually render), then 9–11 in any
order. Tests ship with each step, not after.
