# Retraction — design

2026-08-27 · refs issue #16 ("Retraction should mark the original, not just log the
correction")

**Status: proposal, awaiting human review.** This is a spec, not an implementation.
Nothing below lands until it is approved; the implementation checklist at the end is the
work that follows approval. This spec must not close #16 — implementation does.

## Goal

The model can only append. When a claim turns out wrong, the correction is written
somewhere new, and the false statement stays in the transcript looking exactly as
authoritative as everything around it. #12 gave corrections a place to be *logged*
(the `divergence` channel and the `corrects_id` link); #16 asks for something harder:
that the **original** be marked, so the retraction is visible where the error is, not
only where the fix was written.

This document designs that marking for an append-only system. The organizing insight is
the one academic publishing reached decades ago: a retracted paper is never deleted and
never edited — it is **stamped at read time**. The journal keeps the paper, the
retraction notice is its own citable document, and every subsequent retrieval of the
original carries the stamp. Mark, never mutate. The stamp is derived from the notice;
the paper's bytes never change.

Concretely, the design is five pieces:

| # | piece | mechanism |
|---|---|---|
| 1 | link kinds | new `corrects_kind` column disambiguating retract / amend / resolve |
| 2 | verbatim quoting | new `verbatim` column; the retracted claim, quoted exactly |
| 3 | derived retractedness | standing computed from the `corrects_id` chain at read time; no row is ever rewritten |
| 4 | marked read surfaces | `recall` gains ids and marks; a dumpable retraction register; analytics exclusion rules |
| 5 | session-resume replay | open retractions injected at the start of a resumed session |

Piece 2 is the issue's "nearly free" option; pieces 3–5 are its substantive register;
piece 1 is the prerequisite that keeps the register honest once #42's forecast
resolutions start sharing the `corrects_id` chain.

## Non-goals

- **Editing sent messages.** The transcript is host-owned and immutable; literal
  strikethrough at the original site is not available, and this spec does not pretend
  otherwise. What *is* available is marking every point of re-reading that passes
  through the plugin — `recall`, the register, resume replay — plus a quoting
  convention that makes the transcript itself greppable. The residual gap (a human
  scrolling raw transcript history still sees the unmarked error) is stated plainly in
  the Trust section rather than papered over.
- **Retracting the human's statements.** Every mechanism here is for the model's own
  claims. `corrects_id` can only point at `entries` rows, and the human does not write
  those.
- **A general edit/versioning system.** Retraction is a one-way stamp with an audit
  trail, not document history. "Supersede freely and show only the latest" is a
  different product and an explicitly rejected one (see Alternatives).
- **The visible-revision seam** (`revision.enabled`, #42 thread, default off) — that is
  in-message revision during composition, not retraction of a previously-sent claim.
  The rendering section notes the one place they touch.
- **Automated wrongness detection.** Nothing here decides a claim is wrong; the model
  or the human does. This spec is the machinery for what happens after.

&nbsp;

## The two sites, named honestly

An erroneous claim lives in up to two places, and they have opposite properties:

1. **The transcript** — where the human actually reads. Immutable, host-owned,
   unreachable by any tool this plugin has. The issue's evidence case (a wrong
   checklist rendered from stale memory, sitting above its correction for the rest of
   an 85-turn session) lives here.
2. **The record** — the `entries` table. Fully ours, and *technically* mutable — SQLite
   would happily `UPDATE`. The append-only property of the record is doctrine, not
   physics.

That second point is where trust enters. Because the record *could* be rewritten, the
design must make it structurally evident that it never is: a record that quietly
UPDATEs an old row to say "retracted" is indistinguishable, later, from a record that
quietly UPDATEs an old row to say something flattering. The never-silently-rewrite
property is load-bearing for every downstream use of this data — calibration analysis,
the divergence corpus, the human's ability to check what was actually claimed at the
time. So:

**Invariants (the trust contract):**

1. No `UPDATE` and no `DELETE` ever executes against `entries`. The only write is
   `INSERT`. (The one standing exception in the whole system is schema migration's
   table rebuild, which copies rows verbatim — #42's cross-cutting section — and which
   is versioned, logged, and content-preserving.)
2. A retraction is itself an ordinary appended row: timestamped, session-stamped,
   plugin-versioned, attributed like any other entry. Retracting leaves *more*
   evidence, never less.
3. "Retracted" is a **derived property**, computed at read time from the existence of
   later rows. It is never stored on the original, so there is nothing on the original
   to falsify, backdate, or forget to set.
4. A retraction can itself be retracted ("I was wrong to take that back"), by the same
   appended mechanism, and the read-time computation resolves the chain. Even
   un-retracting rewrites nothing.
5. Marked surfaces **mark**; they do not filter. A retracted entry shown to a human is
   shown struck, not hidden. Only derived *analytics* (trend math, calibration
   denominators) exclude retracted rows, and each exclusion is documented at the query.

&nbsp;

## 1. Link kinds: `corrects_kind`

### The problem it solves

`corrects_id` exists today with the tool-schema description "id of an entry this
retracts" — one column carrying one meaning. #42's forecast design (correctly) reuses
the same chain for forecast **resolution**: an entry with `outcome: 'hit'` pointing at
a `predicted` row. But a resolution is not a retraction — a forecast that *hit* was not
wrong, and a register that lists every resolved forecast as a retracted claim is a
register nobody can trust. The moment the chain carries two meanings, the meaning needs
a column.

There is also a real distinction inside wrongness itself. "The whole claim is wrong,
do not rely on any of it" and "the claim was directionally right but a detail was off"
are different stamps — academic publishing distinguishes retraction from correction
(erratum) for the same reason. Collapsing them forces every small fix to either
overclaim (full retraction of a mostly-right statement) or underclaim (no mark at all).

### Vocabulary and storage

- New vocabulary `CORRECTION_KINDS = ['retracts', 'amends', 'resolves']`:
  - `retracts` — the target claim is wrong; do not rely on it. The target reads as
    **retracted**.
  - `amends` — the target stands in substance; this entry refines or corrects a
    detail. The target reads as **amended**, pointing forward at the refinement.
  - `resolves` — the target was a question open at write time (a `predicted` forecast,
    under #42); this entry closes it. The target is **not** wrong and is never marked
    as such.
- New nullable `entries` column `corrects_kind TEXT` with
  `check('corrects_kind', CORRECTION_KINDS)`.

Cross-field validation (in `entries.validate`, joining the cross-field checks #42
introduces):

- `correctsKind` without `correctsId` → rejected, message names the rule.
- `correctsId` without `correctsKind` → **rejected for new writes.** A link whose
  meaning is unstated is exactly the ambiguity this column exists to end. (Legacy rows
  written before this change carry NULL; see the read rule below.)
- Under #42's columns, when present: `outcome` requires `correctsKind: 'resolves'`,
  and `corrects_kind = 'resolves'` requires the target to be a `predicted` row
  (tool-layer check, where the store is available — same placement as #42's
  wrong-target rule). Whichever of the two specs lands second adds this joint rule;
  each degrades gracefully alone.
- The target must be an earlier row. This holds by construction (the id is not known
  until insert), and the FK already requires existence; the validator adds nothing.

**Legacy read rule:** a pre-existing row with `corrects_id` set and `corrects_kind`
NULL reads as `retracts` — that is what the column's description has promised since v1
— unless it carries an `outcome` (then `resolves`, per #42). The rule lives in the one
place standing is computed (§3), not scattered across queries.

### Alternatives rejected

- **A boolean `retracted` flag on the link row.** Loses amend-vs-retract, and the
  moment #42 lands, "false" would be doing double duty for "amends" and "resolves".
  Three meanings need three names.
- **Inferring kind from context** (outcome present ⇒ resolution; channel divergence ⇒
  retraction). Fails immediately: a divergence entry may amend, a confidence entry may
  retract, and inference rules multiply with every new column. A stated kind is one
  word at write time.
- **A separate `retractions` link table.** A second table for a property of an entry,
  when the design's whole shape is one row per expression with sparse columns — same
  argument that rejected a resolution table in #42.

&nbsp;

## 2. Verbatim quoting: the `verbatim` column

### What it is

The issue's option 2, promoted from convention to column: **a retraction quotes the
retracted claim exactly.** Two jobs, one column:

1. **Greppability against the transcript.** The transcript cannot be marked, but an
   exact quote makes the retraction *findable from* the error: anyone (human or model)
   who searches the transcript for the suspect sentence finds the same bytes in the
   retraction entry. An approximate paraphrase finds nothing. This is what makes the
   immutable site partially recoverable, and it costs one copy-paste.
2. **A self-contained register.** Most wrong claims are prose in the main channel —
   they were never `entries` rows, so there is nothing for `corrects_id` to point at.
   The wrong checklist in the issue's evidence happens to have been a recorded
   `checklist` row; the "icon-sort rule wrong on both sort keys" *statement* was prose.
   The verbatim quote is how a prose-only claim enters the register at all: the
   retraction row carries the original's exact text alongside the replacement, so the
   register can show before → after without the original ever having been a row.

### Storage and validation

- New nullable `entries` column `verbatim TEXT` — the retracted or amended claim,
  quoted exactly as it appeared, untrimmed beyond surrounding whitespace.
- Valid when `corrects_kind` is `retracts` or `amends` (quoting the target row's
  claim), or on a `divergence` entry with no `correctsId` (a prose-only retraction —
  the claim was never recorded, so the quote is the only anchor). Anywhere else →
  rejected.
- Exactness cannot be machine-validated against a transcript the plugin cannot read,
  so exactness is normative (skill-level), not schema-enforced. What the schema *can*
  hold is the slot, so the quote is queryable instead of buried in `text` prose — the
  same unqueryable-text argument that promoted the stems.

Normative rule (skill): a `retracts` or `amends` entry SHOULD carry `verbatim`. It is
not hard-required because sometimes the original is a recorded row whose `text` *is*
the claim verbatim — then `corrects_id` already preserves the exact original and a
copy would be duplication. Required in exactly the case where nothing else preserves
the words: prose-only retraction.

### Alternatives rejected

- **Quote inside `text`.** The 280-character `text` budget must carry the replacement
  and the feeling face; stuffing an exact quote in as well either blows the budget or
  pressures the quote into paraphrase — destroying job 1. A dedicated column has no
  such pressure and is queryable.
- **Hash of the quote instead of the quote.** Greppable in neither direction, and the
  register would show "something was retracted" without being able to say what — the
  silent-falsehood problem this issue exists to end.
- **Requiring a row for every claim so prose-only never happens.** Recording every
  main-channel sentence as an entry is surveillance of the transcript, not
  self-expression, and the no-op-entry doctrine's confabulation warning applies
  doubly to a mandatory record-everything rule.

&nbsp;

## 3. Derived retractedness: standing

### Definition

An entry's **standing** is computed, never stored:

- A row R is a *strike* against target E when `R.corrects_id = E.id` and R's effective
  kind (stated, or the legacy read rule) is `retracts` or `amends`, **and R itself is
  standing**.
- E is **retracted** when some standing strike against it has kind `retracts`.
- E is **amended** when it is not retracted and some standing strike has kind
  `amends`.
- Otherwise E **stands**.

The recursion ("and R itself is standing") is what makes invariant 4 work: retracting
a retraction restores the original, by computation rather than by touching the
original. The recursion is well-founded because a link always points at a strictly
earlier id, so chains cannot cycle; in SQLite it is a recursive CTE, and the practical
chain depth is 2–3.

`resolves` links never affect standing — a resolved forecast stands, with its outcome
beside it. (A forecast that *missed* also stands: "I predicted X" remains a true record
of the prediction. If the *claim* was wrong rather than merely unlucky, that is a
separate `retracts` entry, and the kinds keep the two legible.)

### Where it lives

One helper in `entries.ts`, used by every surface in §4:

- `standingOf(store, ids)` — batch: for a set of entry ids, returns
  `{ id, status: 'stands' | 'amended' | 'retracted', by: number | null }`, where `by`
  is the id of the newest standing strike. Batch rather than per-row so `recall`'s
  listing costs one query, not N.
- `register(store, options)` — the retraction register (§4).

### Alternatives rejected — and this section is the heart of the issue

- **`UPDATE entries SET retracted = 1` on the original.** The obvious design, and the
  one this spec is largely an argument against. It violates invariant 1; it stores a
  derivable value (which then *can* disagree with the chain that implies it — and a
  disagreement between a flag and its evidence is unresolvable after the fact); and it
  makes the record's honesty rest on every future code path remembering to never
  UPDATE anything else. The entire trust posture of this table is "the only verb is
  INSERT"; one legitimate UPDATE path dissolves the structural guarantee into a
  code-review promise.
- **Deleting or overwriting the original.** Named only to be condemned: this is the
  silent rewrite of history, the exact thing the issue's "Important for trust" label
  guards. A record that can lose its errors can lose anything.
- **A `retracted_by` back-pointer column filled in on the original at retraction
  time.** Same UPDATE objection, plus it is the decorations argument from #42 §5:
  derivable data, stored, rots the first time chain semantics gain a case (un-retraction
  would already break it).
- **A materialized "current beliefs" view stored as a table.** Derivable, rots, and
  worse: it invites reading the *clean* view instead of the marked one, which is
  filtering — a violation of invariant 5 by architecture.

&nbsp;

## 4. Marked read surfaces

Marking the original "at its own location" means: every location the plugin controls
through which the original is re-read carries the mark. There are three.

### 4a. `recall`

Two present-day gaps make retraction impossible to even *express* well, and fixing
them is most of this section:

- `recentEntries` does not return `id` — so a model that wants to retract last turn's
  entry cannot learn what to point `correctsId` at, except by remembering the id from
  the `recorded #N` reply at write time. Memory of a previous turn degrading quietly
  is this project's founding observation; the id must come from the record.
- It returns nothing link-shaped, so a retracted entry replays in `recall` output as
  authoritative — the issue's transcript problem, reproduced in the one surface this
  plugin fully owns. A resumed session calling `recall` re-reads its own retracted
  claims unmarked.

Changes:

- `recentEntries` widens to select `id`, `corrects_id`, `corrects_kind`, and
  `verbatim`, and its results pass through `standingOf`, so each returned row carries
  `status` and `by`. Retracted rows are returned **marked, not omitted** (invariant
  5) — the model should see that it retracted something, not develop amnesia about it.
- `recall` gains an optional `retractions: boolean` argument; when true, the reply
  includes the register (4b) alongside `context` / `previous` / `recent`.

### 4b. The retraction register

The issue's option 1. Not a table — a query (`register(store, options)`), because a
register table would be the materialized-view rejection in §3. Each register entry is
one standing strike of kind `retracts` or `amends`, presented as before → after:

```json
{
  "kind"        : "retracts",
  "at"          : "2026-08-27T21:14:09Z",
  "original"    : { "id": 171, "channel": "checklist", "ts_utc": "…", "text": "…" },
  "verbatim"    : "icons sort by status first, then alphabetically",
  "replacement" : { "id": 214, "channel": "divergence", "text": "sort is rank then bucket; misread the skill 😬" }
}
```

`original` is `null` for a prose-only retraction — then `verbatim` is the whole
anchor. Options: session scope, project scope (only when `privacy.storeCwd` allows the
project column to exist at all), a time window, and a limit. Strikes that have
themselves been retracted do not appear (they are not standing), but remain reachable
by reading the chain directly — the register is the *current* state of taken-back
claims, while the table remains the full history of the taking-back.

Dumpable on request: "dump the retraction register" is `recall(retractions: true)`;
no new tool. The tool count stays where it is, and the register arrives with the same
context block recall already carries.

### 4c. Analytics and renderers

The rule pair, stated once and applied everywhere:

- **Display surfaces mark.** Anything that shows entries to a reader (recall's
  listing, future transcript-replay tooling) shows retracted rows struck and amended
  rows annotated.
- **Derived analytics exclude retracted, keep amended.** Trend math treats a retracted
  datum as poison — it was wrong, and its replacement row (when the correction
  re-supplies the datum) is present to be counted instead. Counting both double-counts;
  counting only the wrong one is worse. Amended rows keep their slot: the claim stood.
  Every excluding query documents the exclusion in its DocBlock.

Applied to what exists today:

- `seriesPercents` — the one stored-history path the chart tools replay — excludes
  retracted rows. The issue's evidence case is exactly this: a wrong checklist row,
  later re-rendered corrected; the wrong row's `percent` must not remain in the
  series a sparkline replays. (Caller-supplied chart data is untouched; the caller is
  the authority on data it supplies.)
- `previousSignature` — unchanged in behavior, but gains the standing filter for
  principle's sake: a retracted signature (rare, but a mis-recorded one can be
  retracted like anything else) should not be the delta baseline.
- Calibration (the payoff): retraction rate **by confidence ground** is the highest-
  value derived statistic this design enables. A `verified`-then-retracted claim is
  the alarming quadrant (the checking itself failed); `guessed`-then-retracted is the
  system working as designed. Joined with #42's `faded` rule — faded disclosures are
  never errors, and likewise never retractions — the grounds × standing matrix
  becomes an honest self-calibration table. Like #42's calibration report, the
  dedicated query helper is **deferred** until the ledger is big enough to want it;
  the register plus SQL answers it meanwhile.

&nbsp;

## 5. Rendering: the retraction line and the mark

### The retraction line

Retraction is a link property, not a channel — the act of retracting rides an existing
channel, usually `divergence` (the wrongness register already carries the kind
vocabulary for *how* it went wrong). Composing with #42's decoration table, the
self-state family gains one decorated form:

| line | decoration | backing record |
|---|---|---|
| retract | `! ↩️` | any entry with `corrects_kind: 'retracts'` or `'amends'` |

```diff
! ↩️ retract: ✗ "icons sort by status first, then alphabetically" → rank then bucket 😬
! ↩️ amend: ✗ "171 rows in the session log" → 172; off by the header 😅
```

Grammar: `! ↩️ retract:` (or `amend:`), then `✗ "<verbatim quote>"`, then ` → `, then
the replacement, then the feeling face. The ✗-quote is the rendered face of the
`verbatim` column — straight double quotes around the exact bytes, so the rendered
line and the stored column and the transcript's original all grep to each other. The
backing entry records `channel: 'divergence'` (with its honest `divergence_kind` —
retraction almost always has one: the checklist case was `stale`), plus `correctsId`
when the original was a row, `correctsKind`, and `verbatim`.

Strikethrough is deliberately **not** the in-line mechanism here: channel lines are
diff lines inside code blocks, where `~~` renders as literal tildes (the skill already
documents this for the sarcasm devices). ✗ plus quotes does the same visual work and
survives the code block. The one place tilde-strikethrough legitimately appears near
this feature is inline prose under `revision.enabled` — in-message revision while
composing — which is a different seam and stays #42-thread property.

Timing is normative in the skill: **retract at the moment of discovery, in the same
response**, as close below the point of realization as the prose allows. The mark
cannot reach the original's transcript location, so its proximity in *time* is the
only co-location available; every turn of delay is another screenful of unmarked
error for a scrolling reader.

### The mark on replayed originals

Where a surface renders a retracted entry as a line (rather than JSON), the mark is a
leading `⊘` immediately after the line's marker glyphs, before the text — chosen over
✗ (already the quote bracket above), over 🚫 (reads as prohibition, not withdrawal),
and over ❌ (already the failure marker in the checklist vocabulary). JSON surfaces
carry `status` / `by` fields instead; the glyph is presentation, never stored —
derivable, per the decorations rule.

&nbsp;

## 6. Session-resume replay

The issue's option 3: a long-running or resumed session must not carry silent
falsehoods forward. The register makes this cheap — the open question is transport.

**Mechanism: the turn-start hook, on a session's first turn.** `onUserPromptSubmit`
already opens the database, already computes `turnCount(store, session) + 1`, and
already returns `additionalContext`. When that computed turn index is 1 — a session
this store has never seen before, which is exactly what a fresh start *or* a resume
under a new session id looks like — and `retraction.replay` is enabled, the hook
appends a compact replay segment after the clock and the open reminder:

```text
Recently retracted (do not rely on these): ⊘ "icons sort by status first, then
alphabetically" → rank then bucket (2026-08-25) · ⊘ "the build skips lint on spec-only
PRs" → it runs markdownlint (2026-08-21)
```

Scope: strikes from the last 14 days, same project when the privacy config permits
project columns (else same machine), newest first, capped at 5 — window and cap are
code constants, not config keys, until someone actually wants to tune them (defaults
live in code, and a key nobody asked for is seeding by another name). Each item is the
verbatim quote (truncated to a line) plus the replacement. The whole segment is
omitted when the register is empty — no ritual text on the happy path. The query cost
is one indexed SELECT on a database the hook holds open anyway, and the write path is
untouched, so the fail-open doctrine covers it: any error skips the segment and still
delivers the clock.

Toggle: **`retraction.replay`**, default **on**, via `configure` like every other key
(#30 owns the surface; the name follows its dotted convention). Not an onboarding
question — the segment is a few lines at most, session-start only, and hiding known
falsehoods is a strange thing to offer prominently; the key is the escape hatch, not a
personality choice.

### Alternatives rejected

- **A `SessionStart` hook.** The natural-looking home, and Claude Code has the event —
  but the hook wiring is per-host (`hooks.claude.json`), the other hosts' equivalents
  differ or do not exist, and the plugin's precedent (config in the database, not in
  host config) is that cross-host behavior should not depend on host-specific
  transport when a host-neutral path exists. The turn-start hook fires on every host
  that runs the plugin at all, and "first turn this store has seen of this session"
  is precisely the resume/fresh boundary as observed rather than as claimed. A
  SessionStart variant can be added later purely as an optimization; the turn-index
  trigger is the portable definition.
- **Injecting on *every* turn.** The context line is prime attention real estate;
  repeating the register every turn is how it becomes wallpaper. Once per session,
  plus on-demand via `recall(retractions: true)`, matches how often the information
  changes hands.
- **Replaying inside `recall` only.** Recall is pull; the silent-falsehood problem is
  precisely that nobody knows to pull. Resume replay is the push half; both exist for
  a reason.

&nbsp;

## Trust implications

The label says Important for trust; this section says why each piece earns it, and
what it still cannot do.

- **The record never lies about its past.** Invariants 1–3: INSERT-only, retractions
  as attributed rows, standing derived. There is no code path whose job is to change
  what an old row says, so "what did it claim at the time" always has one answer, and
  the marking machinery cannot be repurposed into an editing machinery.
- **Taking something back is itself on the record.** A retraction that embarrassed
  its author cannot be quietly withdrawn — un-retracting is one more appended,
  timestamped row, and the chain shows both moves forever. The register shows current
  standing; the table shows every change of mind that produced it.
- **The mark cannot be forgotten, because it is not set.** A stored flag has two
  failure modes — set wrongly, or not set — and both are silent. A derived mark has
  neither: if the strike row exists, every surface computes the mark; if it does not,
  there is nothing to mark from. The single point of truth is the same row the human
  can read.
- **Resolutions cannot launder retractions, and vice versa.** The kind vocabulary
  (§1) keeps "I was wrong" and "the forecast closed" as different words. Without it,
  a retraction could be filed as a mere resolution (softening wrongness into
  bookkeeping), and every forecast resolution would inflate the retraction count
  (crying wolf until the register reads as noise). Both failure modes are
  vocabulary-level, so the fix is too.
- **Softening has a name and a boundary.** `amends` exists so detail-fixes do not
  overclaim — but its availability creates the temptation to file full wrongness as
  amendment. The boundary is normative in the skill: *if the reader acting on the
  original claim would be harmed, it is `retracts`.* The grounds × standing analytics
  make systematic softening measurable after the fact, which is the enforcement
  honesty tools actually have.
- **A hidden retraction defeats the purpose.** A retraction row with
  `visible: false` for a claim that was surfaced would mark the record while leaving
  the reader misled — the transcript problem, deliberately reproduced. Normative rule:
  a retraction of a surfaced claim is itself surfaced (the retraction line renders).
  `visible: false` remains legitimate for retracting never-surfaced entries. The
  existing honesty framing of `visible` covers the audit: recorded-but-not-surfaced
  retractions of surfaced claims are exactly the query an auditor runs.
- **What this design cannot do, stated plainly.** It cannot touch the transcript. A
  human scrolling raw history will still read the error before the correction; no
  plugin machinery changes that. What the design buys at that boundary: the verbatim
  quote makes the error findable from the retraction and the retraction findable from
  the error (grep either way); the same-response timing rule minimizes the unmarked
  distance; and every *plugin-mediated* re-reading — recall, register, resume — is
  marked. The claim being made is "no silent falsehood survives re-entry into the
  system", not "the transcript is fixed", and the difference should be kept crisp in
  any user-facing description.

&nbsp;

## Cross-cutting: schema migration

Two new nullable columns (`corrects_kind`, `verbatim`), one with a `CHECK` — so this
rides the same forced table-rebuild machinery #42's cross-cutting section designs, and
lands as part of the same `SCHEMA_VERSION` bump when both are approved together:

- **If #42 lands first:** its v1→v2 rebuild has already built `migrate.ts`; this spec
  adds its columns to the v2 DDL if unreleased, or contributes a v2→v3 step if
  released. The stepwise design makes either ordering mechanical.
- **If this lands first:** it brings the identical migration design with it —
  stepwise `migrate.ts`, the `openStore` read-before-stamp fix (whose current
  unconditional version stamp is a latent bug #42 documents), explicit column lists,
  v1-fixture round-trip test — and #42 stacks on top. The design is written in #42's
  spec and is not duplicated here; it is adopted by reference.

Either way the two specs share one rebuild in the shipped release if approved in the
same window, which is the cheap path: rebuilds are per-version, not per-feature.

&nbsp;

## Cross-cutting: tool surface

`express`:

- New optional arguments `correctsKind` (`CORRECTION_KINDS` enum) and `verbatim`
  (string), described in house style; `correctsId`'s description is corrected from
  "id of an entry this retracts" to "id of an earlier entry this links to; the kind
  says how" — the current wording becomes false the moment kinds exist.
- Cross-field validation per §1–§2, with `describeVocabulary`-style messages.
- The confirmation reply for a `retracts`/`amends` write echoes the target:
  `recorded #214, retracts #171 (checklist)` — a wrong-target retraction should be
  discoverable at write time, not at audit time.

`recall`:

- `recentEntries` widened per §4a (`id`, link columns, `status`, `by`).
- New optional `retractions: boolean` returning the register.

No new tools. `turn_signed` and `configure` untouched. Hook change per §6 only.

&nbsp;

## Cross-cutting: config keys and sibling interfaces

For #30's ledger: one new key, `retraction.replay`, default `true`, this spec. No
onboarding question requested from #40.

Sibling dependencies, by issue:

- **#42 (channel extensions)** — the nearest neighbor, composed with rather than
  contradicted: `resolves` is the kind its forecast resolutions carry (joint
  cross-rule in §1); `faded` disclosures are prospective and are neither errors nor
  retractions (its not-an-error rule extends naturally: faded rows never enter the
  register); the decoration table gains the `! ↩️` row (§5); the schema migration is
  shared (above). If #42's spec is amended in review, the joint rules here follow its
  final shape — the kind vocabulary is this spec's interface, the forecast columns
  are #42's.
- **#12 (divergence column, closed)** — this spec is the "distinct from" half its
  issue text promised: #12 logs that a correction happened; this marks the original.
  The divergence channel is the retraction line's usual carrier, unchanged.
- **#30 (config surface)** — key name and precedence conform; the replay segment
  joins the hook context line, the same transport #42 §3 proposes for conventions
  flags, so the two segments should land as one formatting decision.
- **#40 (onboarding)** — no contact beyond the explicit no-question note.
- **#43 (self-initiated speech)** — the register is a second "something ripened"
  source (a retraction relevant to work now in progress); noted as an interface, no
  dependency either way.

&nbsp;

## Skill changes (`skills/self-expression/SKILL.md`)

One pass, after the code lands:

- The `correctsId` bullet in "Optional fields worth using" grows into a short
  retraction block: the three kinds; the verbatim-quote rule (exact bytes, required
  for prose-only); the retracts-vs-amends boundary ("if acting on the original would
  harm the reader, it is `retracts`"); the same-response timing rule; the
  surfaced-claims-get-surfaced-retractions rule.
- "The other channels, rendered" gains the `! ↩️ retract:` line with the ✗-quote
  grammar and one example of each kind.
- A sentence in the recording section: derive `correctsId` targets from `recall`
  (which now returns ids), never from memory of the `recorded #N` reply.

&nbsp;

## Testing

- **Vocabulary specs**: `CORRECTION_KINDS` membership and lowercase-ASCII invariants;
  exact contents pinned.
- **Entries specs**: cross-field accept/reject matrix (`correctsKind` × `correctsId`
  × `verbatim` × channel); legacy-NULL read rule (reads as `retracts`; as `resolves`
  when an outcome is present, once #42 lands); standing over hand-built chains —
  simple retraction, amendment, retracted retraction restores the original, mixed
  strikes where `retracts` outranks `amends`.
- **Register specs**: row-backed and prose-only entries; non-standing strikes
  excluded; scope and cap options; project scope absent when privacy suppresses
  project columns.
- **Analytics specs**: `seriesPercents` excludes retracted rows and keeps amended
  ones; `previousSignature` skips a retracted signature.
- **Tool specs**: `express` retraction write echoing its target; kind-less link
  rejected; `recall` rows carry `id`/`status`/`by`; `retractions: true` returns the
  register; retracted rows present and marked, never omitted.
- **Hook specs**: first-turn replay segment present with register content, absent
  when empty, absent when `retraction.replay` is `false`; second turn never carries
  it; error path still delivers the clock (fail open).
- **Migration spec**: v1 fixture round-trip extended with the two new columns
  (shared with #42's fixture when the rebuild is shared).
- **Stochastic**: fast-check over randomly generated link DAGs (random ids, kinds,
  strike order) asserting the SQL standing computation agrees with a reference
  implementation in TypeScript — the two may not drift; that agreement is the
  property. A second property: for every generated history, no sequence of API calls
  changes any pre-existing row's bytes (append-only, verified rather than promised).

&nbsp;

## Implementation checklist (follows approval)

1. `src/ts/channels/vocabulary.ts` — `CORRECTION_KINDS` + type, DocBlock carrying the
   retracts/amends boundary rule and the resolves-is-not-wrongness rule; update
   `vocabulary.spec.ts`.
2. `src/ts/channels/schema.ts` — `corrects_kind` (with check) and `verbatim` columns;
   version bump coordinated with #42 (shared rebuild when possible); update
   `schema.spec.ts`.
3. Migration step per the shared design (adopt or extend `migrate.ts`, whichever
   exists first); fixture round-trip test.
4. `src/ts/channels/entries.ts` — `EntryInput` gains `correctsKind` / `verbatim`;
   cross-field validation; insert wiring; `standingOf` and `register` helpers with
   the recursive-CTE standing computation and the legacy-NULL read rule; widen
   `recentEntries`; standing filters on `seriesPercents` and `previousSignature`
   with documented exclusions; update `entries.spec.ts`.
5. `src/ts/mcp/tools.ts` — new `express` arguments, corrected `correctsId`
   description, target-echoing reply; `recall` `retractions` argument and widened
   rows; update tool specs.
6. `src/ts/mcp/hooks.ts` — first-turn replay segment in `onUserPromptSubmit`, gated
   on `retraction.replay`, sharing the context-line formatting with #42's
   conventions-flags segment if that has landed; update `hooks.spec.ts`.
7. Stochastic standing-agreement and append-only specs.
8. `skills/self-expression/SKILL.md` — the one-pass update above.
9. `base_README.md` (README is generated) — the new fields, the register, the config
   key, and a short trust paragraph stating the invariants.
10. Full build green (`npm run build`); PR closes #16.

Sequencing: 1–2 first, 3 with 2 (a constraint change without its migration is the
silent-rejection bug), then 4, then 5–6 in parallel, then 7–9 in any order. Tests ship
with each step, not after.
