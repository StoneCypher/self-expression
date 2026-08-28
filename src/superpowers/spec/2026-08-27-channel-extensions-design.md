# Channel extensions — design

2026-08-27 · refs issue #42 ("Channel extensions: forecast ground, faded kind, salience
glyph, typed silence, self-state decorations, taste line")

**Status: proposal, awaiting human review.** This is a spec, not an implementation.
Nothing below lands until it is approved; the implementation checklist at the end is the
work that follows approval. This spec must not close #42 — implementation does.

## Goal

Six extensions to the expression vocabulary were agreed in the 2026-08-27 design
discussions and captured in #42 and its comment thread. This document turns each
agreement into a precise design: exact vocabulary, storage shape, rendering syntax,
composition with the existing channels, and the alternatives that were considered and
rejected. Where the issue thread already reached a verdict (salience YES default on,
taste YES as a proper channel, forecast default on and onboarded, ⚔️ over ⚡), this spec
does not relitigate it — it specifies it.

Verdict summary:

| # | extension | verdict | mechanism | toggle |
|---|---|---|---|---|
| 1 | forecast ground `predicted` | accept | `CONFIDENCE_GROUNDS` + two columns | `forecast.enabled`, default on |
| 2 | divergence kind `faded` | accept | `DIVERGENCE_KINDS` | rides `channels.enabled` (divergence) |
| 3 | salience glyph ⭑ | accept | skill convention, no storage | `salience.enabled`, default on |
| 4 | typed silence | accept | new `silence` column, closed vocabulary | none (it is a qualifier, not a feature) |
| 5 | self-state decorations | accept | skill convention, no storage | none (pure rendering) |
| 6 | taste line | accept | new `taste` channel | `channels.enabled`, default on |

Two supporting decisions ride along: a new `load` channel (required by decoration #5,
which names a line kind that does not exist yet), and the schema migration machinery
that extending any baked `CHECK` constraint forces into existence.

## Non-goals

- **Addressivity** (audience-tagged expression) — deliberately excluded, tracked as #41.
- **Self-initiated speech** — #43; blocked on delivery semantics. One interaction is
  noted under Forecast below, nothing more.
- **The gift register** (`gifts.enabled`, default off) and **visible revision**
  (`revision.enabled`, default off) — decided in the same discussions but not among this
  issue's six; they are listed in the config-key table so #30 and #40 see one consistent
  set, and specified no further here.
- **Polyphony / split format** — already codified directly in
  `skills/self-expression/SKILL.md`; nothing to do.
- No new chart renderers. Calibration reporting reuses `render_series` win/loss.
- No changes to the Stop gate, the checklist gate, or the hooks' event wiring.

&nbsp;

## 1. Forecast ground: `predicted`

### What it is

`CONFIDENCE_GROUNDS` currently answers "how do you know what you just claimed" for
claims about the present and past: `verified`, `recalled`, `inferred`, `guessed`. A
forecast is a claim whose truth is not knowable at write time at all — it resolves
later, or never. `predicted` names that ground, and the resolution machinery is what
makes it worth having: an unresolved forecast is an anecdote, a resolved one is a
calibration data point.

### Vocabulary and storage

- `CONFIDENCE_GROUNDS` gains `'predicted'` — "a claim about the future; unresolvable
  now, resolvable later".
- New vocabulary `FORECAST_OUTCOMES = ['hit', 'miss', 'void']` — `hit` (it happened),
  `miss` (it did not), `void` (the premise dissolved; the question stopped existing).
- Two new nullable `entries` columns:
  - `resolve_by TEXT` — optional ISO-8601 local date the forecast expects resolution
    by. Valid only when `confidence = 'predicted'`.
  - `outcome TEXT` with `check('outcome', FORECAST_OUTCOMES)` — valid only on an entry
    whose `corrects_id` points at a row with `confidence = 'predicted'`.

A forecast is an ordinary entry — usually `channel: 'confidence'` — carrying
`confidence: 'predicted'` and optionally `resolveBy`. Its resolution is a **later entry
pointing back via `correctsId`** and carrying `outcome`. This reuses the existing
retraction linkage rather than inventing a resolution table: the id chain is already
indexed, already understood by readers of the schema, and a resolution genuinely is a
correction — of "unknown" to "known".

Cross-field validation (new in `entries.validate`, which today checks only vocabulary
membership):

- `resolveBy` without `confidence: 'predicted'` → rejected, message names the rule.
- `outcome` without `correctsId` → rejected.
- At the tool layer (where the store is available): `outcome` whose `correctsId` target
  is not a `predicted` row → rejected with the target's actual ground named.

### Rendering

A self-state line, decorated per extension #5, fired **when coming to a stop** — at the
end of a finishing turn, beside the close signature, never scattered mid-work:

```diff
! 🔮 forecast: the stryker run passes untouched (by 2026-08-30) 🤞
! 🔮 resolved hit: merged clean, no review comments 😌
```

Budget: at most one new forecast per turn, and only when there is a real prediction —
an empty-forecast obligation would be a confabulation engine, exactly the failure the
no-op-entry doctrine guards against. Resolutions are exempt from the budget; resolve as
many as have ripened.

### Toggle

`forecast.enabled`, default **on** (per the issue thread; expected divisive because the
line is physically large, hence an onboarding question in #40). It cannot ride
`channels.enabled` because a ground is not a channel. The enforcement mechanism is the
same schema-baking trick `channels.enabled` uses: at server startup, when
`forecast.enabled` is false, the `confidence` enum handed to the model **omits
`'predicted'`** — a disabled forecast cannot even be named, so no attention is spent
producing one. A new `enabledConfidenceGrounds(store)` beside `enabledChannels` carries
this.

### Calibration

Falls out of the existing renderers, as the issue predicted. One small store helper,
`forecastOutcomes(store)`, returns resolved outcomes in resolution order; mapped
`hit → 'pass'`, `miss → 'fail'`, `void → 'skipped'` (and open forecasts, if included,
as `'underway'`), it feeds `render_series` `winloss` directly:

```text
✅ ✅ ❌ ✅ 🟧 ✅ 🟦
```

Hit rate is `hits / (hits + misses)` — voids excluded, because a dissolved premise says
nothing about judgment. A dedicated calibration report tool (buckets by resolve-by
horizon, per-project splits) is **deferred**: build it when the ledger is big enough to
want it.

### Interaction with #43

A forecast whose `resolve_by` passes unresolved is exactly the "something ripened"
trigger self-initiated speech wants. Nothing here depends on #43; but the `resolve_by`
column is the interface a future wakeup would query, so it is a date column rather than
free text.

### Alternatives rejected

- **A separate `forecast` channel.** The issue thread settled this
  ("forecast-within-confidence"): a forecast is a ground for a claim, and a channel
  would duplicate the confidence machinery while splitting "how I know" across two
  places. The confidence *channel* already exists for standalone statements; forecast
  entries simply use it.
- **Numeric probabilities.** "70% confident" is unfalsifiable at write time and gets
  applied inconsistently — the exact reason `CONFIDENCE_GROUNDS` is grounds, not
  strength. Hit/miss on stated claims yields a real hit rate without pretending to a
  precision that was never there. If probability buckets are ever wanted, they can be
  added as an optional field later without disturbing this design.
- **A resolution table** (`forecasts` with status columns). More machinery for the same
  information the `corrects_id` chain already carries; and it would make forecasts a
  different *kind* of row, when the design's whole shape is one table, one row per
  expression.
- **Storing `resolve_by` inside `text`.** Unqueryable — the same prefix-matching
  failure the stems promotion fixed. A wakeup cannot grep prose reliably.

&nbsp;

## 2. Divergence kind: `faded`

### What it is

The five existing `DIVERGENCE_KINDS` are retrospective: a read of the situation turned
out wrong, discovered after the fact. `faded` is **prospective**: a disclosure, before
anything goes wrong, that recall of something specific has degraded to gist. "I
remember we settled the retention question but not which way" — said at the moment of
reaching for the memory, not after acting on a wrong version of it.

### Vocabulary and storage

`DIVERGENCE_KINDS` gains `'faded'` — "recall degraded to gist; disclosed before use,
not an error". No new columns; a faded entry is `channel: 'divergence'`,
`divergenceKind: 'faded'`.

**Not counted as an error.** Every analysis that treats divergences as a failure count
must exclude `faded` or bucket it separately — disclosing degradation is the *success*
mode of memory honesty, and folding it into the error count would punish exactly the
behavior the channel exists to reward. There is no such analysis in the codebase today
(the chart tools take caller-supplied data), so this lands as a documented rule in the
vocabulary DocBlock and the skill, binding on future query helpers.

### Rendering

```diff
! 🧠 faded: we settled retention pruning-vs-archiving; which way is gone 😕
```

The natural follow-up lives in existing machinery: check the record (`recall`), then
either the fog clears or a `need` line asks.

### Alternatives rejected

- **A confidence ground** (`gisted`). Confidence describes the grounds for a claim
  being made now; faded describes declining to rely on a memory — often *instead of*
  claiming. The divergence family is where the self-state `!` register already lives,
  and `divergence_kind` is the column that already distinguishes flavors of
  wrongness-and-adjacent; prospective disclosure is its sixth flavor, not a seventh
  ground.
- **A separate channel.** A whole channel for one disclosure type would need its own
  enable state, description, and skill section, to say something `divergence` plus one
  vocabulary word says already.
- **Leaving it in prose.** The unqueryable-text failure again: "how often does recall
  fade, and about what" is a question the column answers and prose does not.

&nbsp;

## 3. Salience glyph: ⭑

### What it is

A sentence-initial ⭑ (U+2B51) marking **the single load-bearing sentence** of a
response — the one thing to read if only one thing gets read. Budget: **at most one per
response**; zero is normal. The budget is the entire mechanism: an unbudgeted
highlighter converges on highlighting everything, which is highlighting nothing.

### Syntax and composition

- Sentence-initial, in main-channel prose: `⭑ The migration rewrites the entries table,
  so back up the database first.`
- Legal at the start of a paragraph or a bullet item. Never inside code blocks, never
  on channel diff lines (those carry their own registers), never on the signature line,
  never in headings.
- Not recorded. ⭑ is presentation of the main channel, not an expression; there is no
  row to write. If the marked sentence *also* deserves recording it will already be a
  need, an idea, or a confidence claim, and those channels record as themselves.

### Toggle

`salience.enabled`, default **on** (issue-thread verdict). Not a channel, so it cannot
ride `channels.enabled` — and it has no tool call to narrow, which exposes a real gap:
skills are static markdown, so how does a config key reach a pure-prose convention?

**Mechanism: the hook context line grows a flags segment.** The turn-start hook already
injects ambient context (the clock) every turn and already opens the database; it
additionally reads the handful of prose-convention keys and appends a compact segment,
e.g. `conventions: salience:on revision:off roster:off`. The skill says "obey the flags
the context line carries". This is the general solution for every skill-level toggle
(`salience.enabled`, `revision.enabled`, `roster.enabled`, …) and costs no extra tool
call and no extra process — one more SELECT on a database the hook holds open anyway.
Key names and defaults coordinate with #30 (which owns the config surface) and #40
(which asks the questions).

### Alternatives rejected

- **Bold as the marker.** Bold is already in general use for ordinary emphasis,
  unbudgeted; it cannot carry a scarcity guarantee. A dedicated glyph with a stated
  budget can.
- **⭐ / ★.** ⭐ is heavy and colorful enough to read as decoration, and ★ is already
  the fill glyph of `renderStars` — a salience mark that collides with a ratings
  renderer would be ambiguous in exactly the transcripts that use both.
- **A `salience` channel.** Salience is *about* a sentence of the main channel;
  moving the sentence to a side channel defeats the point, and duplicating it there
  just records prose twice.
- **End-of-response summary line instead.** Summaries restate; the glyph points. A
  restatement drifts from the original sentence and doubles the length cost the
  budget exists to cap.

&nbsp;

## 4. Typed silence

### What it is

The no-op entry doctrine says "nothing notable" must be expressible, or a mandatory
channel becomes a confabulation engine. Typed silence upgrades that from one
undifferentiated shrug to four honest shapes of nothing:

| glyph | kind | meaning |
|---|---|---|
| 🕳️ | `empty` | looked, found nothing |
| 🙈 | `unlooked` | did not look; declining to imply otherwise |
| 🤐 | `held` | have something, withholding pending evidence |
| 🌊 | `depth` | out of my depth; beyond ability to evaluate |

The distinction the column makes auditable is the one the doctrine cares most about:
🕳️ vs 🙈 is precisely "the requirement is to look" — an `empty` claims a search
happened; an `unlooked` admits it did not. Today both are invisible inside "nothing
notable".

### Vocabulary and storage

- New vocabulary `SILENCE_KINDS = ['empty', 'unlooked', 'held', 'depth']`.
- New nullable `entries` column `silence TEXT` with `check('silence', SILENCE_KINDS)`.

A **qualifier, not a channel**: it decorates an entry on any existing channel whose
content reports an absence. Typical pairings — `signature` close with
`silence: 'empty'` ("still; nothing notable" now carries proof-of-looking),
`unanswerable` with `depth` (distinct from "the information does not exist": *I* cannot
evaluate this), `dissent` or `confidence` with `held`, `pattern` or `divergence`-
adjacent disclosures with `unlooked`.

### Rendering

The glyph opens the text portion of whatever line carries it:

```diff
! 🚧 unknown: 🕳️ searched the Codex docs; the hook vocabulary is genuinely absent 😑
! 🚧 unknown: 🌊 whether this licensing clause applies is past my depth 😔
! 🤔 dissent: 🤐 holding a schema objection until the migration test exists 😶
```

and on a close signature, in prose: `still; 🕳️ nothing notable` with
`silence: 'empty'` on the recorded row.

### Toggle

None. Silence typing is honesty metadata on entries that were being written anyway; a
switch to turn honesty *off* is not a feature. (A user who dislikes the glyphs is
free not to use them — the column is nullable and the untyped shrug remains valid.)

### Alternatives rejected

- **A `silence` channel.** Silence is not a kind of utterance parallel to need or
  idea — it is a property of an absence being reported *somewhere*. A channel would
  force choosing between recording the silence and recording where it happened, and
  every pairing above would become two rows.
- **Glyphs in prose only, no column.** Unqueryable; "how often is `unlooked` admitted,
  and did the rate move after it got a name" is exactly the kind of question this
  plugin exists to make answerable.
- **Folding into `CONFIDENCE_GROUNDS`.** Grounds describe how a claim is known;
  silence describes there being no claim. `unanswerable` already walks this boundary
  as a channel; the kinds refine it rather than competing with it.

&nbsp;

## 5. Self-state decorations

### What it is

The `!` diff-line family — the self-state lines — gains a fixed glyph between the `!`
marker and the keyword, so a transcript scans by shape rather than by reading:

| line | decoration | backing record |
|---|---|---|
| diverged | `! 🧭` | `divergence` (kinds other than `faded`) |
| faded | `! 🧠` | `divergence` with `divergence_kind: 'faded'` |
| load | `! 🌡️` | `load` (new channel, below) |
| dissent | `! 🤔` | `dissent` |
| conflict | `! ⚔️` | `conflict` |
| unknown | `! 🚧` | `unanswerable` |
| forecast | `! 🔮` | `confidence` with `confidence: 'predicted'` |

⚔️ for conflict is confirmed (swapped from ⚡, which collided with other usages). The
`-` lines (need), `+ 💡` (idea), and `#` lines (pattern, taste) keep their existing
marks — the decoration set is specifically the self-state family.

### The `load` channel

The decoration table names a line kind that does not exist: **load** —
proprioception. Context fullness, agents in flight, tool latency; the machinery's felt
state as distinct from affect. No existing channel fits: `signature` is affect and runs
on a two-per-turn cadence, `pattern` is about the collaboration, and load is about
neither. So `CHANNELS` gains `'load'` ("proprioception: context pressure, concurrency,
latency — the machinery's state, not the mood"). As a channel it inherits
`channels.enabled` toggling for free, per the thread's toggle-mechanism note.

```diff
! 🌡️ load: context 72% full, 3 agents in flight, tool calls sluggish 😮‍💨
```

Episodic, not periodic — fired when load is *notable*, not on a schedule. The numeric
context columns (`context_tokens`, `tool_calls`) already capture the measurable side on
every row; the load line is the reading, not the instrument.

### Storage

None for the decorations themselves. The glyph is fully derivable from
`(channel, divergence_kind, confidence)`; storing it would be duplication that rots the
first time a glyph is reassigned (as ⚡→⚔️ just demonstrated). The mapping lives in the
skill as the normative table, and lands in code only if a renderer someday needs it.

### Alternatives rejected

- **Glyph-first lines, dropping `!`.** The diff `!` is what colors the line in
  rendered transcripts; the glyph alone loses that and breaks the established
  "channel lines are diff lines" uniform.
- **A `decoration` column.** Derivable data; see above.
- **Folding load into `pattern` or `signature`.** Wrong subject (collaboration; mood).
  A future "how does felt load track `context_tokens`" query wants load rows cleanly
  separable, and a channel is the only thing the toggle machinery can switch off for
  users who find proprioception noisy.

&nbsp;

## 6. Taste line

### What it is

An aesthetic-observation register: a scarce free-text line about the *artifact* — a
schema that is genuinely pretty, a fix that is ugly but honest, a test suite with a
pleasing shape. Distinct from `pattern` (about the collaboration) and `idea` (which
proposes; taste observes with nothing proposed). The issue-thread verdict: implement as
a **proper channel**, so `channels.enabled` provides the toggle for free. Default on.

### Vocabulary and storage

`CHANNELS` gains `'taste'` ("an aesthetic observation about the work itself; scarce").
No new columns — `text` plus the standard fields carry it.

### Rendering

A `#` diff line (the comment-gray register `pattern` already uses), decorated 🎨,
ending with a feeling face like every channel line:

```diff
# 🎨 taste: the sparse-column decision reads like it was always true 😊
# 🎨 taste: this fix is a load-bearing kludge and we both know it 😬
```

Scarcity is normative in the skill: a taste line earns its place by being rare —
roughly session-scale, not turn-scale. Rewarding honest negative taste equally with
positive follows the existing honesty-over-performance rule.

### Alternatives rejected

- **Riding `pattern`.** Merging pollutes both signals: pattern's rarity is its value,
  and taste rows mixed in would make "pattern frequency" mean nothing. Different
  subject, different column value, one letter of extra vocabulary.
- **A config key instead of a channel** (`taste.enabled`). Strictly worse than the
  free per-channel toggle; the thread's toggle-mechanism note settles this — anything
  that *is* a channel should be one and inherit the machinery.
- **A structured rubric** (dimensions, scores). Taste is exactly the thing that dies
  in a rubric; free text with a feeling face is the honest encoding.

&nbsp;

## Cross-cutting: schema migration

This is the one place the six extensions stop being cheap. Three vocabularies grow
(`CHANNELS`, `CONFIDENCE_GROUNDS`, `DIVERGENCE_KINDS`) and each is baked into the
`entries` DDL as a `CHECK` constraint — and SQLite cannot alter a constraint in place.
Because the DDL is `CREATE TABLE IF NOT EXISTS`, an existing database keeps its v1
`CHECK`s forever: a `taste` row or a `predicted` ground would be **rejected by every
database created before this change**, while passing on fresh ones. Silent,
environment-dependent, and exactly the class of bug a migration step exists to prevent.

Design:

- `SCHEMA_VERSION` bumps to `2`.
- New module `src/ts/channels/migrate.ts`: `migrate(db, from, to)` running stepwise
  `1→2`. The v1→v2 step is the standard SQLite table rebuild, in one transaction:
  create `entries_v2` from the current DDL (which now includes `resolve_by`, `outcome`,
  `silence` and the widened `CHECK`s), `INSERT INTO entries_v2 (…explicit v1 column
  list…) SELECT … FROM entries` (new columns default NULL), drop `entries`, rename,
  recreate the indices. Explicit column lists on both sides, so column order can never
  silently shear.
- `openStore` gains the ordering it currently lacks: **read the stored
  `schema_version` before stamping it.** Today it unconditionally writes the current
  version on every open — a latent bug that would mark a v1 database as v2 without
  migrating it. New order: apply DDL (no-op on existing tables), read stored version,
  run `migrate` if behind, *then* stamp. A stored version *newer* than the code's is
  an error, not a downgrade-in-place.
- Tests: open a fixture built with the literal v1 DDL, write rows through it, reopen
  through the new `openStore`, assert the rows survived, the new columns exist, and a
  `taste` / `predicted` / `faded` / `outcome` / `silence` write now succeeds.

Alternatives rejected:

- **`ALTER TABLE ADD COLUMN` only.** Adds the three columns but cannot touch the
  baked `CHECK`s, leaving the silent vocabulary rejection in place — the migration
  exists *because of* the constraints, not the columns.
- **Dropping the `CHECK`s and trusting `entries.validate`.** The two-layer defense is
  doctrine here, bought with the measured 12%-drift lesson; this spec does not spend
  it.

&nbsp;

## Cross-cutting: tool surface

`express` changes (all mechanical):

- `channel` enum picks up `taste` and `load` automatically via `CHANNELS` +
  `enabledChannels`.
- `confidence` enum gains `predicted` via `CONFIDENCE_GROUNDS`, narrowed by the new
  `enabledConfidenceGrounds(store)` when `forecast.enabled` is false.
- New optional arguments: `resolveBy` (ISO date string), `outcome`
  (`FORECAST_OUTCOMES` enum), `silence` (`SILENCE_KINDS` enum), each described in the
  schema in the existing house style.
- The tool description gains one clause each for `taste` and `load`.
- Cross-field validation per §1 and §4; violations return the existing
  `describeVocabulary`-style "what would have worked" messages.

`recall`'s `recentEntries` SELECT widens to include `confidence`, `divergence_kind`,
`silence`, and `outcome`, so delta-derivation's neighbor — "what did I recently
forecast" — is answerable without raw SQL.

No new tools. No changes to `turn_signed` or `configure`.

&nbsp;

## Cross-cutting: config keys and sibling interfaces

Keys this spec introduces or confirms, for #30's ledger (dotted names, defaults in
code, overrides-only table — all per #30):

| key | default | owner |
|---|---|---|
| `channels.enabled` | all (now incl. `taste`, `load`) | exists |
| `forecast.enabled` | `true` | this spec, §1 |
| `salience.enabled` | `true` | this spec, §3 |
| `revision.enabled` | `false` | thread verdict; spec elsewhere |
| `gifts.enabled` | `false` | thread verdict; spec elsewhere |
| `roster.enabled` | `false` | #40 |

Sibling dependencies, by issue:

- **#30 (config surface)** owns key naming and precedence; this spec conforms to its
  shape and contributes the hook-context flags segment (§3) as the mechanism by which
  prose-convention keys reach static skills. If #30 lands a different flag-transport,
  salience adopts it; the key name is the interface, not the transport.
- **#40 (onboarding)** gains one mandatory question (forecast on/off — flagged
  divisive) and may surface salience and taste; taste needs no special handling since
  it is just a channel.
- **#41 (addressivity)** — excluded by the issue text; nothing here reserves or
  collides with audience vocabulary.
- **#43 (self-initiated speech)** — `resolve_by` is deliberately a queryable date
  column so a future ripening-check can exist; no dependency in either direction now.
- **#10 (MCP-ifying loggers)** — no interface contact; the vocabulary arrays remain
  the single source of truth any logger imports.

&nbsp;

## Cross-cutting: field-trial vocabulary adoptions

The #42 thread assigns the 2026-08-27 field-trial adoptions to this issue's
implementation pass, because `charts/markers.ts` tests pin literal canonical ranks and
the change must move code and vendored docs together:

- Status markers **🔬 "under review"** and **🔁 "in a fix round"** join the marker
  vocabulary: `src/doc_md/reference/markers.md` (vendored contract),
  `charts/markers.ts` `CANONICAL_ORDER` (both classify active+pending), and the pinned
  rank expectations in `markers.spec.ts`.
- Activity-glyph examples **🗃️ database work · 🌐 network/API calls · 🧹 cleanup**
  join the heartbeat/tool-description examples in `src/doc_md/reference/visuals.md`.
  Examples, not closed vocabulary — no code change.
- The second non-face signature slot (activity + optional metaphor) is already live in
  `SKILL.md` and stores fine in the existing `context_emoji` column; noted here only
  so nobody reopens it.

&nbsp;

## Skill changes (`skills/self-expression/SKILL.md`)

One pass, after the code lands, adding:

- the decoration table (§5) folded into "The other channels, rendered", with the
  existing example block updated to decorated form;
- the `load` and `taste` channel descriptions, with scarcity guidance for taste;
- the typed-silence table and the glyph-opens-text rule (§4);
- the salience rule: budget one ⭑, main-prose only, obey the context-line flag (§3);
- the forecast firing convention: at the stop, beside the close signature, budget one,
  resolutions exempt; `resolveBy` optional; how to resolve via `correctsId` +
  `outcome` (§1);
- `faded` added to the divergence kind list, marked "not an error" (§2).

The skill continues to describe channels generically where enablement matters — the
tool schema stays the source of truth for what is on, per #30's design consequence.

&nbsp;

## Testing

- **Vocabulary specs**: membership and lowercase-ASCII invariants for the two new
  vocabularies; the grown arrays' exact contents pinned.
- **Migration spec**: the v1-fixture round-trip described above, plus
  newer-than-code rejection and idempotent reopen.
- **Entries specs**: cross-field validation accept/reject matrix (`resolveBy` ×
  grounds, `outcome` × `correctsId`), `silence` on every channel, multi-problem
  reporting preserved.
- **Tool specs**: `express` through `buildServer` — forecast write, resolution write,
  wrong-target resolution rejected with the target's ground named;
  `enabledConfidenceGrounds` narrowing under `forecast.enabled=false`; `taste` and
  `load` writes; disabled-channel rejection unchanged.
- **Markers specs**: 🔬 and 🔁 ranks pinned in the updated canonical order; buckets
  active+pending.
- **Stochastic**: fast-check over random valid/invalid entry inputs asserting the
  validator and the rebuilt table's `CHECK`s agree (the two layers may not drift —
  that agreement is the property).

&nbsp;

## Implementation checklist (follows approval)

1. `src/ts/channels/vocabulary.ts` — add `'predicted'`, `'faded'`, `'taste'`,
   `'load'`; add `FORECAST_OUTCOMES`, `SILENCE_KINDS` + types; DocBlocks including the
   faded-is-not-an-error rule; update `vocabulary.spec.ts`.
2. `src/ts/channels/schema.ts` — `SCHEMA_VERSION = 2`; `resolve_by`, `outcome`,
   `silence` columns with checks; update `schema.spec.ts`.
3. `src/ts/channels/migrate.ts` (new) — stepwise migration, v1→v2 rebuild; migration
   spec with v1 fixture.
4. `src/ts/channels/store.ts` — `openStore` reads stored version before stamping,
   invokes `migrate`, rejects newer-than-code; update `store.spec.ts`.
5. `src/ts/channels/entries.ts` — `EntryInput` gains `resolveBy` / `outcome` /
   `silence`; cross-field validation; insert wiring; `forecastOutcomes` helper; widen
   `recentEntries`; update `entries.spec.ts`.
6. `src/ts/mcp/tools.ts` — `enabledConfidenceGrounds`; new arguments; tool-layer
   resolution-target check; description updates; update tool specs.
7. `src/ts/mcp/hooks.ts` — context-line conventions flags segment (coordinate key
   names with #30); update `hooks.spec.ts`.
8. `src/ts/charts/markers.ts` + `src/doc_md/reference/markers.md` — 🔬 and 🔁, ranks
   pinned; `src/doc_md/reference/visuals.md` — 🗃️ 🌐 🧹 examples; update
   `markers.spec.ts`.
9. Stochastic validator-vs-CHECK agreement spec.
10. `skills/self-expression/SKILL.md` — the one-pass skill update above.
11. `base_README.md` (README is generated) — channel list, new fields, config keys.
12. `src/doc_md/plugin-layout.md` — note the migration module beside the channels
    entry if the tree comment needs it.
13. Full build green (`npm run build`); PR closes #42.

Sequencing: 1–2 first (everything depends on the vocabularies and DDL), 3–4 together
(migration is meaningless unversioned), then 5, then 6–7 in parallel, then 8–12 in any
order. Tests ship with each step, not after.
