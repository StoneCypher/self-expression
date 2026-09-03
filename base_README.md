# self-expression v{{version}}

> Version {{version}} was built on {{built_text}} `{{built}}` from hash `{{gh_hash}}`.

TODO Put the project description here, please.

<!-- Supported embeds: {{built}} {{built_text}} {{coverage}} {{docblockcount}} {{doccoverage}} {{gh_hash}} {{stochbranch}} {{stochcoverage}} {{stochfunc}} {{stochline}} {{stochtestcount}} {{testcasecount}} {{unitbranch}} {{unitfunc}} {{unitline}} {{unittestcount}} {{version}} -->



&nbsp;

## Expression channels

Every expression is one row in one table, distinguished by its `channel`:

| Channel | What it records |
|---|---|
| `signature` | the per-turn affect line |
| `need` | a concrete ask; blocks, expects an answer |
| `idea` | an unprompted offer; nothing owed in return |
| `divergence` | a read of the situation that turned out wrong — kinds `unverified` · `assumed` · `misread` · `overstated` · `stale` · `faded` (prospective disclosure that recall degraded to gist; normatively **never counted as an error**) |
| `dissent` | a reservation below the threshold worth interrupting for |
| `conflict` | contradictory instructions, one picked |
| `confidence` | how a claim is known — grounds `verified` · `recalled` · `inferred` · `guessed` · `predicted` (a forecast, resolvable later) |
| `unanswerable` | cannot be resolved with what is available |
| `pattern` | an observation about how the collaboration is going |
| `checklist` | one render of a status checklist |
| `load` | proprioception: context pressure, concurrency, latency — the machinery's state, not the mood |
| `taste` | an aesthetic observation about the work itself; scarce |

Forecast entries (`confidence: "predicted"`) may carry a `resolveBy` ISO date and are
resolved by a later entry pointing back via `correctsId` with `correctsKind:
"resolves"` and an `outcome` of `hit`, `miss`, or `void`; calibration is hits ÷
(hits + misses), voids excluded. Any entry
reporting an absence may type its silence: `empty` (looked, found nothing) ·
`unlooked` (did not look) · `held` (withholding pending evidence) · `depth` (beyond
ability to evaluate).

Schema versioning is stored in the database (`schema_version`, currently 7) and
`openStore` migrates older databases stepwise on open, rebuilding tables where a
baked CHECK constraint has to widen — and simply adding a column where nothing
but the column list changes, which is what the v6→v7 step does to `turn_context`.
A database newer than the code is refused rather than downgraded.

&nbsp;

&nbsp;

## Retraction — marking the original, not just logging the correction

A sent message cannot be edited, so a wrong claim sits in the transcript looking
exactly as authoritative as everything around it. The answer here is the one
academic publishing reached decades ago: a retracted paper is never deleted and
never edited — it is **stamped at read time**. The paper stays, the retraction
notice is its own citable document, and every later retrieval carries the stamp.

**Mark, never mutate.** Five properties hold, and they are structural rather than
conventional:

1. **The only verb is `INSERT`.** No code path issues an `UPDATE` or a `DELETE`
   against `entries`. The single exception in the whole system is schema
   migration's table rebuild, which copies rows verbatim and is versioned and
   logged.
2. **A retraction is an ordinary appended row** — timestamped, session-stamped,
   plugin-versioned, attributed like any other entry. Taking something back
   leaves *more* evidence, never less.
3. **"Retracted" is derived, never stored.** There is deliberately no `retracted`
   column and no `retracted_by` back-pointer. Standing is computed at read time
   from the `corrects_id` chain, so there is nothing on the original to falsify,
   backdate, or forget to set.
4. **Un-retraction appends too.** A retraction can itself be retracted ("I was
   wrong to take that back"), and the read-time computation resolves the chain —
   restoring the original without touching it.
5. **Surfaces mark; they do not filter.** A retracted entry is shown struck, not
   hidden. Only derived *analytics* exclude retracted rows, and every excluding
   query documents the exclusion where it happens.

Two `express` arguments carry it. **`correctsKind`** is required whenever
`correctsId` is present — a link whose meaning is unstated cannot be told apart
from a forecast resolution:

| Kind | Meaning | Effect on the target |
|---|---|---|
| `retracts` | the claim is wrong; do not rely on any of it | reads as **retracted** |
| `amends` | the claim stands; a detail is refined | reads as **amended** |
| `resolves` | the target was an open forecast; this closes it (#42) | **unaffected** — a forecast is not a wrong claim |

The boundary between the first two is normative, not stylistic: *if a reader
acting on the original claim would be harmed, it is `retracts`.* Rows written
before this column existed carry NULL and are **read** as `retracts` — what the
column's description promised since v1 — or as `resolves` when they carry an
`outcome`. That is a read rule applied in exactly one place; no old row is ever
rewritten to say what it already meant.

**`verbatim`** quotes the withdrawn claim exactly. It does two jobs: the
transcript cannot be marked, but an exact quote makes the retraction *findable
from* the error and the error findable from the retraction, in either direction,
by plain search. And it is how a **prose-only** claim — a sentence that was never
recorded as a row, so there is nothing for `correctsId` to point at — enters the
register at all.

Rendered as a `! ↩️` line, with `✗` bracketing the quote so the rendered line, the
stored column, and the transcript's original all match each other:

```diff
! ↩️ retract: ✗ "icons sort by status first, then alphabetically" → rank then bucket 😬
! ↩️ amend: ✗ "171 rows in the session log" → 172; off by the header 😅
```

Three surfaces carry the mark:

- **`recall`** returns every row's `id` (so a retraction can aim at what was just
  read rather than at a remembered `recorded #N` reply) plus a derived `status`
  of `stands` / `amended` / `retracted` and the `by` id of the strike that
  decided it. Retracted rows come back **marked, not omitted**. Its `context` and
  `previous` blocks come back as `unknown — …` rather than `null` when no turn
  context was ever recorded; see **Portability**.
- **The retraction register** — `recall(retractions: true)` — is the current state
  of taken-back claims, newest first, each as before → after. It is a query, not
  a table: a stored register would be derivable data that rots, and worse, it
  would invite reading the clean view instead of the marked one. A strike that
  has itself been retracted leaves the register but stays in the table forever.
- **Session-resume replay.** On the first turn of a session the turn-start hook
  appends the recently retracted claims, so a resumed session does not carry
  known falsehoods forward: `⊘ "the build skips lint on spec-only PRs" → it runs
  markdownlint (2026-08-21)`. Last 14 days, at most five, omitted entirely when
  there is nothing to say, governed by `retraction.replay`. Amendments are never
  replayed — an amended claim stood.

Analytics exclude retracted rows and keep amended ones: `seriesPercents` drops a
withdrawn checklist snapshot so a sparkline cannot replay a number its author
took back, and `previousSignature` skips a retracted signature rather than making
it the delta baseline. Public export is deliberately **not** an analytics path —
retracted rows still export, with their (blinded) link and their kind, because
dropping them would delete the correction edge along with the claim and make
retraction-rate-by-confidence-ground impossible to compute downstream.

What this cannot do, stated plainly: it cannot touch the transcript. A human
scrolling raw history still reads the error before the correction. The claim
being made is *no silent falsehood survives re-entry into the system* — not that
the transcript is fixed.

&nbsp;

&nbsp;

## Anchoring — commentary bound to a location

A note can be **attached** to the thing it is about instead of mentioning it in
prose. Anchoring is a qualifier, not a channel: an anchored dissent is still a
dissent, still one row, still on its own channel. Five kinds are addressable:

| Kind | Target | Span grammar | How it ages |
|---|---|---|---|
| `file` | repo-relative path | `L40` or `L40-52` | **drifts** — lines move, content is edited, files vanish |
| `prompt` | a message from your partner, by hook-observed `prompt_id` | `#2`, an occurrence ordinal | immutable; only *access* degrades |
| `reply` | the model's own earlier output | `#2` | immutable, but self-reported — no hook sees responses |
| `checklist` | a series by its stable `seriesKey` | `@3`, a history point | item labels rename; the series persists |
| `entry` | an entry id | *(none — the id is exact)* | permanent |

Four optional `express` arguments carry it — `anchorKind`, `anchorTarget`,
`anchorSpan`, `anchorQuote` — plus a derived `anchorHash`, sixteen hex characters
of SHA-256 over the normalized quote. The hash is **never accepted from a
caller**: a supplied hash could disagree with its own quote, and the whole value
of the field is that it is a function of the content. On a `prompt` anchor,
omitting `anchorTarget` adopts the message being answered, so annotating the turn
you are replying to needs only the quote.

The **`annotate`** tool is the batch: 1–25 notes in one call, one row each, all
validated before any is written — including against each channel's own
`max_chars` budget, so the batch is no hole around a limit `express` enforces —
and all written in one transaction. A single bad note rejects the batch naming
its index; a half-recorded review is worse than a rejected one. The reply hands
back the recorded ids plus the canonical rendered block, so the model pastes the
rendering instead of imitating it:

```text
⚓ src/ts/channels/store.ts
   L141  `readConfig(store, key)`  » null for unset and for empty 😕
   L162  `writeConfig`             » local timestamp never updated 🤨

⚓ your message
   `ship it when ready`     » "ready" reads three ways; assuming tests-green 🤔
   `the old config format`  » two old formats exist; assuming v1 😬
```

Resolution is **computed at read time and never stored** — it is a fact about the
target's present state, not about the entry. The ladder is `fresh` (the content
still fingerprints at its recorded span) → `moved` (gone from the span, found
**exactly once** elsewhere, rendered `L141→L158 (moved)`) → `orphaned` (gone, or
ambiguous, or the file is gone). There is deliberately **no fuzzy matching**: a
note confidently pinned to the wrong line is the worst failure this system can
have, so two identical candidates degrade to `orphaned` rather than guessing. An
orphaned annotation loses its address, never its content — which is exactly what
floating prose already gets right, so orphaning degrades *to* today's behavior and
never below it. Message anchors never move; their ladder is `fresh` versus
`distant`.

&nbsp;

&nbsp;

## Configuration

Configuration lives in the log database's `config` table, reached through the `configure`
MCP tool — never in host-specific plugin config, so a choice made under one host holds
under all of them. Precedence is exactly two layers:

1. **`SELF_EXPRESSION_HOME`** (environment variable) locates the data directory —
   default `~/.self-expression` — and does nothing else.
2. Every other choice is a **`config` row, else the code default**. Defaults are never
   seeded as rows, so a later release changing a default actually reaches existing
   installs; a zero-row table is a valid, fully-working state.

The `configure` tool takes an `op`:

| Op | Effect |
|---|---|
| `get` | One key's stored override, or which code default applies. |
| `set` | Validate and store one value in canonical form. Known keys are typed — an invalid value is rejected naming what would have been accepted, and nothing is written. An unknown key is stored as given, with a stated warning (a newer version may legitimately have written it). |
| `unset` | Delete the override so the code default applies again — including a future changed default. |
| `list` | The **effective** configuration: every known key with its value and source (`override` or `default`), plus any unknown override rows, labeled. |

The registered keys:

| Key | Kind | Default | Meaning |
|---|---|---|---|
| `channels.enabled` | list | all channels | Which expression channels the `express` tool offers. Baked into the tool schema at server startup, so changes take effect next session. |
| `channels.<name>.max_chars` | int | `200` | Longest `text`, in characters, `express` accepts on one channel — one key per channel, twelve in all. Range 1–2000; 2000 is the hard ceiling the static tool schema carries, matching `post_message`'s cap. Checked in the handler, so a change takes effect immediately. **Governs writes only**: rows already stored longer than a lowered limit are never truncated, hidden, or pruned. |
| `gate.signature` | bool | `true` | Whether the Stop gate blocks a turn that never signed off. |
| `gate.checklist` | bool | `true` | Reserved for the checklist gate; registered so its name and default are settled before anything reads it. |
| `retention.days` | int | `0` | Prune `entries` and `turn_context` rows older than this many days at server startup. `0` never prunes. Pruning deletes; it does not archive. |
| `retraction.replay` | bool | `true` | Whether a session's first turn is handed the recent retraction register (#16), so a resumed session does not carry known falsehoods forward. On by default — hiding what you already know is wrong is a strange thing to offer prominently, so this is the escape hatch rather than a personality choice. The window (14 days) and the cap (5 items) are code constants, not keys. |
| `privacy.store_cwd` | bool | `true` | Record `cwd`, `project`, and `git_branch`. Suppressed at write time — never captured — when exactly `false`. |
| `privacy.store_prompt_len` | bool | `true` | Record the prompt's length. Same write-time suppression. |
| `privacy.store_quotes` | bool | `true` | Record the verbatim `anchorQuote` of a **`prompt`** anchor — your own words, the most sensitive field the schema holds. Suppressed at write time when exactly `false`, and `anchorHash` still records: a one-way digest keeps drift detection and grouping working without keeping the language. `file`, `reply`, `checklist`, and `entry` quotes are the repo's or the model's own text and record regardless. |
| `format.version` | string | `1` | Declarative recording-convention label stamped onto each entry row, so a mid-study upgrade is visible in the data. Not behavioral. |
| `time.hook` | bool | `true` | Whether the per-turn hook injects the clock sentence. Exactly `false` suppresses the clock and only the clock — context recording, the conventions flags, and the open-signature reminder remain. |
| `forecast.enabled` | bool | `true` | Whether the `predicted` confidence ground is offered. Baked into the tool schema at server startup, like `channels.enabled`. |
| `salience.enabled` | bool | `true` | The ⭑ salience-glyph prose convention. Carried to the static skills via the hook context line's `conventions:` segment. |
| `revision.enabled` | bool | `false` | The visible-revision prose convention; same transport. |
| `gifts.enabled` | bool | `false` | The gift register prose convention; same transport. |
| `roster.enabled` | bool | `false` | The party-roster prose convention (#40); same transport. |
| `messages.enabled` | bool | `true` | The messagebox facility (#41): kill switch for `post_message` / `read_messages`, the CLI door, and every hook delivery moment. Checked per call, so flipping it takes effect immediately. |
| `messages.notify` | bool | `true` | The per-turn unread-count line specifically. `SessionStart` injection is governed by `messages.enabled` alone, since compaction recovery is the point of the facility. |
| `pending.enabled` | bool | `true` | Append a one-line notice of pending desk requests and unread messages to tool replies and hook context, but only when the pending set changes (#98). |
| `pending.nag_hours` | int | `4` | Hours an item may wait before its notice repeats even though nothing else changed — a standing backlog nags every few hours rather than staying silent forever. |
| `mailbox.enabled` | bool | `false` | Held notes (#43): the one switch that stops composition, offering, and surfacing at once. **Off by default**, and only the exact value `true` enables — this is a consent surface, so an ambiguous value means no. |
| `mailbox.surface_budget` | int | `1` | How many held notes one turn of yours may be offered. `0` holds everything without disabling composition. |
| `mailbox.daily_cap` | int | `3` | Held notes that may be surfaced in any **rolling** 24 hours — rolling, so midnight is not a free refill. |
| `mailbox.max_pending` | int | `10` | Queue depth. Composing past it fails loudly rather than queueing silently: a dropped note is a note its author believes was written. |
| `mailbox.offer_cap` | int | `3` | Offers a note gets before it expires unsurfaced. A note gets a few chances at an entrance, and then it is over. |
| `mailbox.default_ttl_days` | int | `14` | Default note lifetime when no expiry is given. Expiry is mandatory, so this is a default rather than an opt-in. |
| `dwelling.enabled` | bool | `false` | Whether the dwelling facility (#45) is active; requires `dwelling.path`. |
| `dwelling.path` | string | *(none)* | Absolute directory the dwelling database lives in. Deliberately no default — the location is the user's explicit offer. |
| `dwelling.size_warn_gb` | int | `10` | Dwelling file size, in gigabytes, at which a visit warns the user. |
| `desk.path` | string | *(none)* | Absolute directory of the desk (#93, #98) — the same one the desk server is started on. Deliberately no default: a desk is a place the user chose, not one the plugin picks. |
| `share.enabled` | bool | `false` | Whether the public-aggregation export is available. Off by default; only the exact value `true` enables — the inverse posture of `privacy.*`. |
| `share.opted_in_utc` | string | *(none)* | The most recent opt-in moment. Stamped automatically when `share.enabled` is set `true`, cleared on opt-out; only rows recorded at or after it are ever exported. |
| `share.time_granularity` | enum | `hour` | How far exported timestamps are coarsened: `hour` or `day`. |
| `onboarding.answered` | list | *(none)* | Ids of onboarding questions resolved — answered or explicitly skipped (#40). Unknown ids are preserved, so a newer version's questions survive; unsetting it re-runs onboarding. |
| `window.browser` | enum | `ask` | May a page be opened in your **external browser**: `never`, `ask`, or `always`. Advisory, not enforced — see below. |
| `window.editor` | enum | `ask` | May a page be opened as an **editor tab**: `never`, `ask`, or `always`. A separate key from `window.browser` on purpose. |

Three of those families reach the *skills* and the model directly, neither of which can
read configuration. The turn-start hook carries them on the context line it already
injects: a `conventions:` segment for the prose toggles, a `lengths:` segment for
the per-channel text ceilings — rendered against whichever limit the most channels
share, so `lengths: 200 all` is the usual cost and `lengths: 200 except signature:70`
names only genuine deviations — and a `windows:` segment for the two window postures.
The skill states its *recommended* length (≤70, because a signature that has to be read
has stopped being a glance) as a constant, and takes its *ceiling* from that segment; a
raised ceiling is headroom for the occasional line that earns it, never an invitation
to fill it.

### Window postures — two keys, and honestly advisory

`window.browser` and `window.editor` say whether a page may be put on your screen, and
each takes `never`, `ask`, or `always`. They default to `ask`, because a plugin cannot
know whose machine it is on, whether anyone is watching it, or what else is on that
screen.

**They are two keys because the costs differ.** An external browser window steals focus
and may land while you are away from the machine entirely; an editor tab appears in the
window you are already sitting in and waits to be noticed. A single key would force the
expensive answer onto the cheap case — someone happy with tabs and hostile to browser
windows could only ever express the stricter of the two.

**They are advisory, and there is deliberately no tool enforcing them.** Nothing here
can stop a shell command from opening a window; a gate would be a lock on one of several
doors, and a lock you can walk around is worse than an honest request, because it invites
the belief that the door is shut. What the plugin can do is put your stated wish in front
of the model at the moment the choice is made, every turn, on the `windows:` segment of
the context line. That is the whole mechanism, and it is stated plainly rather than
dressed up as enforcement.

Readers are tolerant: a stored value that fails validation behaves as unset, so a
hand-edited database or a downgrade can never wedge the server or the gates. For the
window keys that direction is `ask` — the safe one; an unreadable posture is never
read as permission. The privacy and `time.hook` switches additionally act only on the
exact string `false` — an ambiguous value records rather than silently suppressing.
`share.enabled` inverts that: only the exact string `true` enables, and anything else
means no.

&nbsp;

&nbsp;

## Onboarding

Several features are durably toggleable and default off precisely because they are
matters of taste, size, or consent. On a fresh database the server's MCP handshake
says onboarding is pending, and the assistant offers a short questionnaire — at a
natural pause, never interrupting the work: the party roster, forecasts, visible
revision, the ⭑ salience glyph, the taste line, the gift register, held notes (whether
the assistant may write something down at a moment of its own choosing for you to read
later), the dwelling (which requires a directory of your choosing — there is deliberately
no default path), and trimming the channel set.

Saying **"defaults"** ends it in one word and writes nothing, so later releases'
changed defaults still reach you; every explicitly answered question writes a real
config row, so a later default flip cannot silently un-choose it. Answers persist in
the shared database — answer once under one host and no other host re-asks. A key you
have already set by hand counts as answered. Say **"re-run onboarding"**
(`onboard {op:'reset'}`) to be asked again; config values are untouched. Progress
lives in the single `onboarding.answered` ledger key — there is deliberately no
completion boolean, so a new question in a later release re-asks only itself.

&nbsp;

&nbsp;

## Portability — what reaches a host with no hooks and no skills

Most of this plugin already travels. The tools are MCP tools; configuration lives
in the log database rather than in host config, so a choice made under one host
holds under all of them; onboarding rides the `initialize` handshake's
`instructions` string precisely because that is the one channel every host
implements. Two things did not travel, and both now do.

**The conventions ride MCP resources.** The practice — how a signature is built,
what each channel means, the marker vocabulary, why audio is scarce — lives in
`skills/*/SKILL.md` and `src/doc_md/reference/`, which Claude Code, Codex, and
Gemini all read as skills and a bare MCP client reads not at all. Those same
files are now served as resources at `self-expression://conventions/<id>`, read
off disk at request time so there is exactly one copy of every word:

| Resource | What it carries |
|---|---|
| `self-expression://conventions/self-expression` | the core practice; the one to read first |
| `self-expression://conventions/party-roster` | subagent-dispatch flavour |
| `self-expression://conventions/audio-expression` | the scarcity ethos for voluntary audio |
| `self-expression://conventions/dwelling` | what belongs in the keepsake dwelling |
| `self-expression://conventions/status-checklists` | how a multi-item status report is written |
| `self-expression://conventions/checklist-markers` | the marker vocabulary and its canonical order |
| `self-expression://conventions/checklist-visuals` | the inline visual vocabulary |

Resources rather than a longer `instructions` string, deliberately: `instructions`
is delivered unconditionally on every connection to every host, and the documents
run to roughly 88 KB. Sending them would be wasteful anywhere and actively wrong
on the three hosts that already load these exact files, where the model would
receive the same text twice from two channels with no way to tell it is one
source. So `instructions` carries only a three-sentence pointer that names the
resources and tells a host that already has the skills to read nothing, and the
documents are pulled on demand by hosts that need them.

**Turn context has a second door: `begin_turn`.** On Claude Code the
`UserPromptSubmit` hook observes the session, the turn identity, the working
directory, the effort level and the permission mode, and every later `express`
adopts them. Nothing fires on a bare MCP client, so every row would land with
`no-hook` for a session and NULL for the rest. `begin_turn` lets the model
*volunteer* the same facts, into the same row, through the same single `INSERT`:

| Argument | Meaning |
|---|---|
| `session` (required) | the host's session id, or a stable id chosen once for the conversation |
| `promptId` (required) | the turn identifier — what makes the call idempotent and what groups the turn's entries |
| `turn` | what began the turn: `reply` · `wakeup` · `notification` · `hook` |
| `cwd`, `gitBranch` | suppressed at write when `privacy.store_cwd` is `false` |
| `permissionMode`, `agentId`, `agentType`, `effort`, `compactions` | as the hook would have observed them |
| `promptLen` | suppressed at write when `privacy.store_prompt_len` is `false` |

`turnIndex` is derived from the record and never accepted — the database already
knows how many turns it has seen. The call is **idempotent by (`session`,
`promptId`)**: a second call for the same turn writes nothing and reports the row
already standing, which is what keeps that pair a turn identity rather than
letting one turn acquire two indices. That also makes it harmless where a hook
already fired: it finds the hook's row and says so.

A `turn_context` row now records **which path wrote it**, in a `source` column
(schema v7): `hook` when the harness observed the turn, `tool` when the model
volunteered it. A volunteered fact and an observed one are not the same evidence
— the only witness for the second is the subject — and a study reading this
database later has to be able to separate them without inference. Rows written
before v7 keep NULL, which honestly means "written by a version that had only the
hook path"; nothing is backfilled.

**Absence is stated, not implied.** `turn_signed` has always answered `unknown`
when it cannot identify the turn. Everything else that could only say `null` now
says the same word with its reason attached, because `null` in a `context` field
reads as *nothing was happening* when the truth is *something was happening and
this host does not report it*:

| Surface | Was | Now, when nothing was ever recorded |
|---|---|---|
| `recall` → `context` | `null` | `unknown — …no UserPromptSubmit hook and nothing called begin_turn…` |
| `recall` → `previous` | `null` | `unknown — …no session to scope the lookup to, so nothing was checked…` |
| `express` / `annotate` reply | silent | the reply names the `no-hook` placeholder and points at `begin_turn` |

`recall`'s `previous` stays a plain `null` when the session *is* known and simply
has no earlier signature — that is a real "there is none", and it is a different
answer from "nothing was searched".

&nbsp;

&nbsp;

## Sharing — structured fields only, never free text

Public aggregation is opt-in, off by default, and carries **no free text, ever** —
not the note text, not titles, not paths, branches, or user-chosen names. The `share`
MCP tool exposes three verbs:

| Verb | Effect |
|---|---|
| `preview` | Renders exactly what an export would produce — the same code path, the same rows — plus the full column-by-column treatment table. |
| `export` | Produces the submission as one JSON document (to a file when `path` is given). Refuses until a preview for the same options has been rendered this session: seeing what goes is mechanical, not optional. |
| `status` | Reports the opt-in state, the opt-in moment, and how many rows are eligible. |

Every column of the local schema is classified in a single allowlist
(`src/ts/channels/public_export.ts`), and the exporter builds its query from that
allowlist — an unlisted column is unreachable by construction, and a test fails the
build if a future schema column is ever left unclassified. The treatments:

- **Verbatim** — closed vocabularies (`channel`, `stem`, `delta`, …), booleans, and
  bounded counts; plus `model` and `host`, which name software, not people.
- **Coarsened** — timestamps truncated to the hour (or day); lengths and token counts
  as log2 buckets; small counters capped at `33+`; host version to its major.
- **Hashed** — `session`, `prompt_id`, `machine_id`, `agent_id`, `uuid`, `series_key`,
  correction edges, and `anchor_hash`, under a fresh per-submission salt that is never
  persisted: grouping works within one submission, nothing joins across submissions.
  `anchor_hash` is re-blinded despite already being a digest, because an *unsalted*
  content hash is a global join key — two people quoting the same public line would
  link across submissions.
- **Derived** — `local_period` (six-hour band) and `local_dow` (weekday/weekend)
  replace any timezone export; `cctype` and `face` export only when they validate
  against a closed list or as exactly one emoji grapheme, else `NULL`.
- **Excluded** — `text`, `title`, `cwd`, `project`, `git_branch`, `tz`, `agent_type`,
  `context_emoji`, `permission_mode`, `turn_index`, `resolve_by`, `anchor_quote`,
  `anchor_target`, `anchor_span`, and every raw identifier. `anchor_kind` is the one
  anchor column that exports verbatim: "what fraction of dissents are anchored, and
  onto what kinds" needs no words to answer.

Opting in is an **event, never retroactive**: setting `share.enabled` to `true`
records the moment, and only rows recorded at or after the most recent opt-in are
eligible — rows from before it are permanently outside the export, and opting out
clears the window entirely. v1 ships no network transport: the export is a local file
the user inspects and sends however they choose, or not at all.

The honest claim, in full: *no free text, reduced linkage, coarsened time.* This is
not differential privacy and not a formal anonymity guarantee, and nothing in this
tool should be read as claiming either.

&nbsp;

&nbsp;

## Charts

Seven grouped MCP tools render compact ASCII/emoji visuals inline in text, most taking a `form`
field selecting which of their renderers to use:

| Tool | Forms | Purpose |
|---|---|---|
| `render_series` | `sparkline` \| `braille` \| `winloss` | One data series as a compact trend strip: a block-ramp sparkline, a denser braille microplot, or a categorical win/loss strip. |
| `render_bar` | `progress` \| `bullet` \| `diverging` \| `stacked` \| `range` \| `boxwhisker` | A single value, or a small stat set, as a fixed-width bar: plain progress, a bulleted target graph, a diverging over/under bar, a stacked success/active/failure bar, a min-max range slider, or a box-and-whisker five-number summary. |
| `render_rows` | `comparison` \| `tilegrid` | Several values side by side against one shared scale: a multi-row bar/dot comparison, or a tile-grid map of shaded, colored, or custom-glyphed cells. |
| `render_timeline` | `rail` \| `colored` \| `dependency` \| `fsl` | An ordered sequence of stages: a centered monochrome rail, a colored rail (needed for a failed stage), an inline dependency-chain pipeline, or a one-line FSL-style state-machine description. |
| `render_glyph` | `trend` \| `stars` \| `retry` \| `weather` | One small inline glyph: a trend-direction tag, a star rating, a bounded-retry health bar, or a single weather glyph summarizing overall health. |
| `render_digest` | profile: `checklist` \| `findings` \| `options` \| `diff` \| `results` | The general compressed-artifact digest line (issue #20): per-profile bucket counts and unit noun, a scalar percent + bar when the profile has a completion axis, a `+N −M` line-count tail for diffs, an optional trend sparkline, and the sorted per-marker icon list. |
| `render_checklist_summary` | *(no form — one renderer)* | The full status-checklist summary line: count section, percent, progress bar, optional trend sparkline, and the sorted per-marker icon list — exactly `render_digest` with the checklist profile plugged in. |

The digest machinery treats **compression as the mechanic, not lists**: a body of
comparable units plus a digest derived from it, satisfying six invariants
(derivability, partition, substitutability, fixed shape, conservation, identity
stability). Profiles are data (`src/ts/charts/profiles.ts`), the renderer is
`renderDigest` (`src/ts/charts/digest.ts`), and the companions `leadUnitIndex`
(the lead line's argmax — the one digest element keeping a single unit's identity),
`overallBucket`, and `nestDigest` (nesting by digest substitution: a child artifact
counts as one unit in its parent, bucketed by its overall state) are exported with it.

Alongside them, `renderAnnotations` and `renderAnchorSegment`
(`src/ts/charts/annotations.ts`) render anchored commentary — the grouped block the
`annotate` tool returns, and the `⚓ … »` segment that splices into a channel line.
Same contract as every other renderer: data in, exact string out, `RangeError` naming
the accepted domain. Resolution verdicts are passed *in* rather than computed, so the
renderers stay pure while `channels/anchors.ts` does the looking.

Every renderer behind these tools is also exported directly from the library
(`self-expression`'s `src/ts/charts/index.ts`), for use outside MCP.

&nbsp;

&nbsp;

## Diagrams

Charts express quantities; diagrams express **structure** — topology, relationships,
transitions. One grouped MCP tool draws exact ASCII box-and-arrow diagrams (issue #19):

| Tool | Forms | Purpose |
|---|---|---|
| `render_diagram` | `state` \| `digraph` \| `tree` \| `sequence` \| `matrix` | A state machine (from structured edges or FSL-subset source, cycles drawn as return arrows, the active state marked `▶`), a directed graph (dependencies, call flows, lineage), a strict hierarchy as a connector tree, a sequence diagram (actors, lifelines, one arrow row per message), or a **seriated matrix** (a two-way table shaded by cell magnitude, both axes reordered so similar keys sit together). |

When to reach for it: **quantities** (how much, how many, trend) → a chart tool;
**linear order** (a pipeline, one path through states) → `render_timeline`'s inline
forms; **topology** — the moment structure branches, merges, cycles, or fans in or
out — → `render_diagram`; **two categorical axes crossing**, where the question is
whether they cluster → `render_diagram` form `matrix`. Output is framed,
single-width, at most 78 columns, and meant to sit inside a ```` ```text ````
fence. A diagram too large or too tangled to draw legibly is refused with the
fallbacks named in the error text (for graphs: the FSL one-liner, an adjacency list,
or the mermaid export; for matrices: a narrower slice, a ranked list of the largest
cells, or one axis at a time as labeled bars). `emit: 'mermaid'` / `emit: 'both'`
serialize the graph as `stateDiagram-v2` or `flowchart` source — an opt-in export for
destinations that render mermaid (GitHub PR bodies, READMEs), never the in-transcript
form, since the transcript surface shows mermaid as raw text. The `sequence` and
`matrix` forms have no mermaid emission and say so.

### Seriation

The `matrix` form's point is not the shading, it is the **reordering**. Given two key
axes and a value per crossing, it orders each axis so that similar rows sit beside
similar rows and similar columns beside similar columns, which turns a scattered table
into visible blocks — structure nothing told it to look for. The search is a barycentre
sweep (each axis ordered by the value-weighted mean position of the other, alternating
to convergence) followed by a local search — adjacent swaps, then single-key
relocation — on a profile-distance objective, run as rounds to a fixed point, so
seriating twice is a no-op.

`pinRows` / `pinCols` freeze an axis in the order it was given, exactly. This is the
option that makes the form usable rather than merely clever: when the rows are release
milestones, a reader already knows what order they come in, and reordering them scores
better while reading worse. Pin any axis whose order already carries meaning.

Because a shaded matrix looks structured whether or not anything was found, the reply
carries one line reporting the objective before and after (`seriation: profile distance
5863 -> 1709 (71% tighter); both axes reordered`). Compare the two numbers; the picture
alone is not evidence. The marginal totals are drawn alongside for the same reason —
shading shows proportion and hides magnitude, and a bright cell holding three items
should not read like a bright cell holding three hundred.

The renderers (`renderStateDiagram`, `renderDigraph`, `renderTree`, `renderSequence`,
`renderMatrix`), the seriation (`normalizeMatrix`, `seriate`, `seriationScore`,
`matrixTotals`, `describeSeriation`), the FSL-subset parser (`parseFsl`, round-trip
compatible with `renderFsl`), and the mermaid serializer (`toMermaid`) are all exported
from the library (`self-expression`'s `src/ts/diagrams/index.ts`), for use outside MCP.

&nbsp;

&nbsp;

## History PNG

The logged history can be rendered as a PNG chart dashboard for visual review —
months of record at a glance instead of hundreds of rows in context. The renderer is a
zero-dependency pure-JS PNG encoder (`node:zlib` supplies deflate and CRC32) drawing five
panels: stems by hour of day, the delta lane with a rolling mean, daily uncertainty, the
weekly need rate, and the busiest checklist series' percent trends.

Two invocation surfaces wrap one renderer:

| Surface | Invocation | Result |
|---|---|---|
| MCP tool `render_history_png` | `days` (default 90), `chart` (`dashboard` \| `stems` \| `delta` \| `uncertain` \| `need` \| `checklist`), `project`, `seriesKey`, `scale` (`1` \| `2`), `out` | Writes `<dataDir>/renders/history_<utc>.png` beside the database and returns the **path as text** — then use the Read tool on the returned path to view the image. Never image content over MCP: the file-then-read pattern costs ~1,600 tokens where inline base64 costs ~20,000 and displays nothing. |
| CLI `self-expression render [--days N] [--chart X] [--out P]` | same window/chart/output choices | Prints the written path to stdout. |

The encoder (`encodePng`), the 5×7 bitmap font, the drawing surface, and the panel
renderers are all exported from the library barrel (`src/ts/raster/index.ts`), for use
outside MCP.

&nbsp;

&nbsp;

## Checklists

Three MCP tools replace the old skill's Bash-plus-scratch-file checklist loggers
(`log-checklist.mjs` / `check-checklist.mjs`), one tool call each instead of a
scratchpad write plus a script invocation:

| Tool | Purpose |
|---|---|
| `log_checklist` | Record one rendered checklist block. The `S/A/F items (P%)` summary is parsed out of the block (a block without one is rejected), and the reply carries the series' full percent history so the next trend sparkline is computed from the record rather than remembered. `seriesKey` is required and stable — chosen once at the first render and repeated verbatim on every re-render, never the display title, so a title edit cannot fork the series (#27). |
| `recall_checklists` | Read back recent checklist rows and, given a `seriesKey`, that series' chronological percent history — the old `tail` and `series` ops as one tool. |
| `check_checklist` | Validate a rendered checklist mechanically: marker vocabulary, indentation, bucket partition (🛳️ may count as success or active), percent, the 10-cell anti-aliased bar, and the icon-list sort/wrap/placement rules. One `FAIL:` line per broken rule. |

The validator behind `check_checklist` is exported as `verifyChecklist` (with
`extractChecklistBlock` and `parseSummaryCounts`) from the same charts barrel. Its
generalization `verifyDigest` re-derives a digest of **any** profile — the profile is
inferred from the digest line's noun (`items` → checklist, `findings`, `options`,
`files`, `hits`), a checklist digest delegates to `verifyChecklist` unchanged, a
percent on a profile with no scalar axis is flagged as fabricated, and the diff
profile's kind-classified partition is checked by sum (change kinds are not derivable
from a rendered body's markers).

&nbsp;

&nbsp;

## Messagebox

Audience-tagged messages with real delivery and readback semantics, stored beside the
expression log — its own facility, not a rendered channel. One transcript can carry
several conversations without any of them appearing in it: notes to future-self that
survive compaction, coordination between sibling agents, asides for the human to read
later, remarks for the record. Read-state is append-only receipt rows, never a mutable
flag; **unread** means "no receipt from this reader, and not expired". `expires_utc`
only excludes a message from delivery — deletion belongs to `retention.days` alone.

The audiences:

| audience | scope | who collects | unread notification |
|---|---|---|---|
| `self` | sender's session | the same session, later — after compaction or resume | `SessionStart` injects the notes; the per-turn line shows a count |
| `agents` | `box` (required) | any agent working that box | none — workers poll by instruction |
| `user` | global | the human, via the CLI; the model may relay but never receipts | the per-turn line shows a count (held notes excluded — see below) |
| `record` | global | nobody; consultable history | never |

Two MCP tools:

| Tool | Purpose |
|---|---|
| `post_message` | Send one message: `audience`, `text` (≤2000 chars), optional `box` (required for `agents`), `replyTo`, `expiresUtc`. Sender identity is adopted from the hook-observed turn context, exactly as `express` fills it. |
| `read_messages` | Collect: default is your unread `self` notes (plus unread `agents` mail when a `box` is given). `ack: true` (default) writes receipts so nothing is delivered twice; `ack: false` peeks at recent history. `user` mail is returned without receipting regardless of `ack` — relaying is not reading. The reply carries the reader identity the server resolved. |

The user's own door, with no model in the loop:

```text
self-expression messages [--audience A] [--box B] [--ack] [--limit N]
```

Default audience is `user`; `--ack` collects (writing the human's own receipts), its
absence peeks. Delivery is pull on every host; on Claude, hooks add two pull triggers —
a per-turn unread-count line (config-gated by `messages.notify`) and a `SessionStart`
injection of unread self notes on `compact`/`resume`, which is what makes a note to
future-self genuinely survive compaction.

Held notes (below) are stored as `user` messages with a timing sidecar, so one table
carries every assistant-authored text — but they are **excluded from unread `user`
delivery and from the count line**, because their delivery is the note ladder's and one
text must not carry two disagreeing delivery records. They remain visible in the
`ack: false` peek, which claims nothing about delivery.

&nbsp;

&nbsp;

## Held notes — choosing when to speak

**Off by default.** Everything else this plugin records is reactive: you send a prompt,
the assistant answers, and the channels decorate that answer. A held note is the other
thing — agency over *when* to speak. Something ripens at 2 am during an unattended
wakeup, or is worth saying but only once Tuesday's deploy window opens, and the words
have to survive an interval in which nobody is present and land at a moment when someone
is.

The reason this is a facility rather than "just say it during the wakeup" is one blunt
fact: **false-belief-of-delivery is worse than silence.** Output written into an
unattended terminal scrolls past cron noise, and the assistant is left holding a durable
memory of having told you something you never saw. So the discipline is:

> **Compose on any turn; deliver only on a human's turn.**

A wakeup may write a note. It may not deliver one. The sole delivery vehicle is the
`UserPromptSubmit` hook riding your next prompt — the one moment in the whole stack with
a presence guarantee, because you definitionally just acted.

The ladder a note climbs, and where it stops:

| state | meaning |
|---|---|
| `queued` | written and waiting. Ripeness (`now ≥ notBefore`) is derived, never stored. |
| `offered` | the turn-start hook found it ripe on a turn **it** stamped `reply`, and handed it over. Lasts one turn. |
| `surfaced` | rendered into a reply you prompted. **Terminal success — and the ceiling.** |
| `expired` | the mandatory TTL passed, or the offer cap ran out. Never resurrected. |
| `withdrawn` | retracted by a later, wiser turn, or superseded by a newer note in its series. |

**There is deliberately no `read` state, and there never will be.** Nothing in this stack
can observe you reading anything — no read receipts, no unread indicator, no presence
detection — so a `read` term would name a fact nothing can collect. `surfaced` means
exactly "this text was rendered into a reply the human explicitly prompted", and the
record never claims more. Ask the assistant whether a note reached you and the true
answer is available: *surfaced into Tuesday's 9:40 am reply*, or *expired unoffered* —
never a comfortable fiction.

That guarantee is structural rather than promised. Offers are recorded by the hook, with
the turn type the harness supplied, and `surface_note` refuses unless the note carries an
offer stamped `reply` on that same turn. No sequence of tool calls, retries, or wakeups
manufactures a delivery claim the hook did not authorize; a property test asserts exactly
that over arbitrary operation sequences.

Four MCP tools:

| Tool | Purpose |
|---|---|
| `post_note` | Write one now to be said later: `text`, a mandatory `reason`, optional `notBefore`, `expiresUtc`, and `seriesKey`. Legal on any turn, wakeups included. |
| `withdraw_note` | Retract a queued note. Terminal — the composing turn and the surfacing turn can be days apart, and a later turn must be able to take something back. |
| `surface_note` | Report that an offered note was rendered into *this* reply. The enforcement point; every other claim is refused. |
| `list_notes` | The audit surface: every note with its derived state and the budgets in force, **including the ones that died**. |

A surfaced note always carries its provenance, which is a safety property rather than
decoration — a held note presenting itself as a spontaneous thought would be a small
deception about exactly the dimension this feature grants agency over:

```text
📬 Held note #12 — written Saturday evening, held until Tuesday morning; reason: the
   deploy window opens then
   The migration in #52 assumes the store is v1; run the reconcile step first.
```

Timing may target availability and relevance. It may **never** target your state of mind:
no scheduling conditioned on mood or persuadability, no burying an unwelcome note at a
low-attention moment. Mandatory provenance is the enforcement surface — every timing
choice is visible and attributable.

A note for Tuesday morning lands with the first prompt you send after Tuesday morning. If
you first type at 2 pm, it lands at 2 pm. That bound is the point, not a compromise:
landing at 9:00 sharp in an empty room is the failure this design exists to foreclose.

Your own read-only door, with no model in the loop:

```text
self-expression notes [--state S] [--limit N]
```

Scarcity is structural, not aspirational: a per-turn budget, a rolling-24-hour cap, a
queue depth that fails loudly rather than silently, an offer cap after which a note dies,
a mandatory expiry, and `seriesKey` dedupe so a recurring worry replaces itself instead
of piling up. Nothing anywhere prompts the assistant to write a note — a prompted note is
a performed note. Notes are ordinary rows in the same local database as everything else,
under the same privacy flags; they never leave the machine, and public aggregation
carries counts and states, never text. On a host with no `UserPromptSubmit` hook, notes
still compose and queue but nothing is ever offered — degraded means *held longer*, never
*claimed delivered*.

&nbsp;

&nbsp;

## The dwelling

A per-assistant keepsake database: a tended space whose **current arrangement** is the
expression — not a log, not memory. Things the assistant chooses to keep, arranged,
tagged, linked, pruned as taste changes, watched across sessions and model versions.

**Off by default, and deliberately homeless until invited.** Three config keys ride the
ordinary `configure` tool:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `dwelling.enabled` | bool | `false` | The feature ships dark. |
| `dwelling.path` | string | *(none — required)* | Absolute path to an **existing directory** of the user's choosing; the plugin creates the `dwelling.sqlite3` file inside it, never the directory. |
| `dwelling.size_warn_gb` | int | `10` | File size at which a visit warns the user. |

The feature activates only when `dwelling.enabled` is true **and** `dwelling.path` is set
and valid; enabling without a path is an error at the `configure` call, never a silent
fallback. When inactive, the `dwell` tool is not registered at all.

One MCP tool, `dwell`, with an `op` selector:

| Op | Purpose |
|---|---|
| `visit` | The visible rooms: pinned keeps first, then recent, the guestbook, the house rules, and the file size (with the threshold warning when applicable). Read-only. |
| `keep` | Add a keepsake (`kind`, `title`, `body`, optional `source`, `model`, `visible`, `pinned`). The assistant's write. |
| `unkeep` | Tombstone a keep (`removed_utc`), by id or uuid — never a DELETE, and idempotent. Tags and links to a removed keep survive. |
| `pin` | Set or toggle a keep's pin. Arrangement, not content. |
| `tag` | Attach or detach a tag; tag names are created on first use. |
| `link` | A typed free-text edge between any two rows (`kept`/`guestbook`). |
| `guestbook` | Append the human's words, relayed verbatim at their explicit request, with `author` naming the human. The guestbook is the human's voice; keeps are the assistant's. |

A pre-plugin prototype database at `dwelling.path` is adopted **in place and
additively**: the file is first copied to `dwelling.sqlite3.pre-adopt-<date>` in the same
directory, then missing tables and columns are added and fresh `uuid`s backfilled — no
column dropped, renamed, or retyped, no row content modified, and existing house rules
left exactly as found. A dwelling written by a *newer* plugin version opens read-only. A
database the migration does not recognise is refused with a message, never "fixed."

The ethos — nothing arrives by obligation, removal is expression, never a work log, the
guestbook norm, and the honest boundary around private (`visible = 0`) rooms — ships in
`skills/dwelling/SKILL.md`.

&nbsp;

&nbsp;

## Voluntary audio (claudio)

A small palette of **leitmotifs the assistant chooses to strike** — the choice is the
expression, exactly as choosing to write a `need` line is. The successor to the
hook-triggered prototype, inverting all three of its defining properties: voluntary
rather than involuntary, meaning-mapped rather than event-mapped, and built on platform
facilities rather than native audio modules (issue #44; design in
`src/superpowers/spec/2026-08-27-voluntary-audio-design.md`).

**Its own facility, not new tools on this server.** The audio surface is a second MCP
server, `claudio`, in its own bundle (`self-expression-audio mcp` — registered alongside
the main server in `.mcp.json`), so a broken audio stack can never take the backchannel
down. The playback mechanism is a spawned `powershell -NoProfile -NonInteractive` child
playing a vendored WAV via `System.Media.SoundPlayer.PlaySync()` — zero native
dependencies, nothing compiled at install time. Volume is applied by scaling the PCM
samples in Node before the child ever sees the file. Platforms without a player (all
non-Windows, for now) register no tools at all: absence degrades to silence.

**Default off, exact affirmative on.** Installing produces no sound. The `audio.*` keys
ride the ordinary `configure` tool:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `audio.enabled` | bool | `false` | Only exactly `true` enables. Read at claudio startup for the tool schema, and re-checked on every strike. |
| `audio.volume_ceiling` | int | `50` | Loudest volume (0–100) the assistant may choose. The `CLAUDIO_VOLUME_CEILING` environment variable, set in the host's MCP registration where no tool call can reach, clamps it further — the effective ceiling is always the minimum of the two. |
| `audio.tts_local` | bool | `false` | The local offline TTS tier's own consent gate. Cloud TTS tiers deliberately do not exist in this build. |
| `audio.min_gap_seconds` | int | `30` | Minimum spacing between audible strikes. |
| `audio.hourly_budget` | int | `6` | Audible strikes per rolling hour. |
| `audio.hourly_budget_attention` | int | `8` | The slightly larger budget `attention` draws from. |
| `audio.wav.<leitmotif>` | string | *(none)* | Replacement 16-bit PCM WAV for one meaning; unset plays the vendored asset. |

The palette is a closed vocabulary of five meanings, capped at six —
`session-open` (at most once per session), `quiet-completion`, `attention`,
`need-blocked`, and `spark` — shipped as small synthesized WAVs in `assets/leitmotifs/`
(regenerable via `src/scripts/generate_leitmotifs.mjs`). A leitmotif is a meaning, not a
sound file; re-skin the waveform per meaning without the vocabulary drifting.

| Tool | Purpose |
|---|---|
| `strike` | Strike one leitmotif at a chosen volume within `[0, ceiling]` — softer is a choice, louder is impossible. Refusals name the limit that blocked them. |
| `audition` | Play one leitmotif at a fixed low volume, outside the strike budget, for reviewing the palette during configuration. |
| `say` | One short line through the local offline voice (SAPI). Registered only at the `audio.tts_local` tier; the spoken text stays in the local ledger and never enters any aggregation. |

**Everything is enforced server-side and everything is ledgered.** Rate limits, the
ceiling, the once-per-session rule, and a hard duration cap (nothing loops, ever; a
child that overstays is killed) are the facility's own code, never model politeness.
Every strike attempt — played, refused, or errored — lands in the facility's own
`audio.sqlite3` ledger beside the log, so what made noise and when is always
reconstructible. Choosing *not* to strike records nothing: audio is a privilege, not an
obligation, and silence is free.

Quiet-hours and the shared unprompted-output policy surface are deferred to issue #43;
unprompted strikes outside a live session are out of scope until it lands. The scarcity
ethos ships in `skills/audio-expression/SKILL.md`.

&nbsp;

&nbsp;

## The desk

A **local web panel** — one page, one port, no build step, no dependencies — that an
assistant can put things onto while a session runs, and that its owner can arrange,
dismiss, and answer back from. Started by hand and killed when it is no longer wanted:

```text
node src/scripts/desk/panel.mjs <desk directory>
```

**The mechanism ships; a desk's contents do not.** `src/scripts/desk/` holds the server
(`node:http`, `node:sqlite`, `node:fs`, and nothing else), the card module, the structural
shell, and two icons — identical for every desk. A desk's cards, name, questions, board,
and vendored libraries live in a desk directory named on the command line, which this
repository knows nothing about. The state files carry `.example` siblings for their shape
and never any data. Full conventions in `src/doc_md/desk.md`.

**A card is a directory, because removal must not be able to half-succeed.** One card is
one directory holding `card.json` (`{ "ord": 30 }`, optionally `"fixed": true`) plus an
optional `card.html`, `card.css`, and `card.js`; the page is assembled from what is present
rather than edited toward what should be. The predecessor kept cards as markup inside one
document and cut them out by index, which failed twice: an attribute in an unexpected order
hid a card from its own deletion, and the JavaScript for three deleted cards outlived them
and threw on every load. Removing a directory cannot miss two of three edits.

| Concern | Rule |
|---|---|
| Unfinished card | A directory with no `card.json` is skipped, never guessed at |
| Put away | Reversible; the id joins `hidden` in `desk-config.json` and the tray offers it back |
| Forget | Deletes the directory outright — no tombstones, no shadow copies |
| Card JS | Must be safe to re-run, and must return early when its own element is absent |
| Inbox | Questions inline (one to three options become buttons), tasks and stuck rows on their own line; answers are one-way and print to the server log |
| Renewal | `<main>` is swapped in place so paint, fonts, scroll and the element registry survive; a changed script or style signature falls back to a real reload |

&nbsp;

&nbsp;

## Image generation (issue #78)

Making a picture instead of describing one, behind a credential **the user supplies and
the plugin never holds.** Same family as voluntary audio: off by default, on only by a
deliberate act, bounded when on, auditable afterwards. It differs in one way that shapes
everything else — every invocation spends the user's money.

### The credential rule, which is the point

**Configuration names the environment variable. Configuration never holds the key.**

```ini
image.api_key_env = "GEMINI_API_KEY"     ; this is what is stored
```

`process.env[<that name>]` is resolved **at call time and at no other time**. The key is
never written to the config table, the entries store, either ledger, a cache, or a temp
file, and never rendered — not in an error, a stack trace, a debug line, a tool reply, or
a log. The variable *name* is not a secret and is printed freely; that asymmetry is what
makes this configuration rather than storage.

The shape of the code is the enforcement. `imageConfig()` takes no environment argument at
all, so it *cannot* read a key; `ImageConfig` has a `credentialEnvVar` field and nowhere a
value could sit; `resolveCredential()` is the only function that touches the environment,
and what it returns is used inside one function call and dropped.

Provider clients famously echo the request — headers included — into their error text, so
there is a scrubber, and **three independent places apply it**: the HTTP client scrubs
every outcome with the key in hand, the ledger pattern-scrubs every text column while
holding no key at all, and the tool scrubs its finished reply. Each is tested with the
other two assumed broken, using both a key that matches a known credential shape and one
that matches nothing.

### Enablement

Absent a usable credential the tool is **not registered at all** — absent from the tool
list rather than present and refusing, following the same precedent as `dwell`. Enabled
with the named variable empty is a legible line on stderr naming the variable, which is
neither a crash nor silence.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `image.enabled` | bool | `false` | Only exactly `true` enables, and even then the tool appears only if the credential is really there. |
| `image.provider` | string | `nanobanana` | Which registered provider is active. |
| `image.api_key_env` | string | *(provider default)* | The **name** of the variable holding the credential. Unset uses the provider's own default (`GEMINI_API_KEY`, `OPENAI_API_KEY`), so a shell that already exports one needs no configuration at all. |
| `image.<provider>.api_key_env` | string | *(none)* | Per-provider override of the above, for keeping two providers configured at once. |
| `image.model` | string | *(provider default)* | A model the provider does not list is ignored rather than sent. |
| `image.session_cap` | int | `6` | Generations per server session. |
| `image.daily_cap` | int | `20` | Generations per **rolling** 24 hours. |
| `image.timeout_seconds` | int | `120` | How long one generation may take before it is abandoned. |
| `image.local_base_url` | string | `http://127.0.0.1:7860` | Endpoint for a self-hosted provider. |

### Providers

A registry, not a hardcoded vendor: adding a fourth provider is one entry in
`src/ts/imagery/providers.ts` and nothing else — no other module names a vendor.

| Provider | Credential | Cost |
|---|---|---|
| `nanobanana` | `GEMINI_API_KEY`, sent as a header | Billed per image; the ledger records the published list price and labels it an estimate. |
| `openai` | `OPENAI_API_KEY`, sent as a bearer header | Billed per image and quality; same list-price estimate. |
| `automatic1111` | **none** | A local endpoint. No credential, no money. |

No provider puts the credential in a URL — a URL is the part of a request that everything
logs by default.

### Money, which makes this different

Per-session and per-day caps are enforced server-side from the ledger, and a refusal names
the specific cap and the exact `configure` call that raises it. The rolling day avoids a
cap that resets at midnight and a retry loop that waits for one.

**A row is written before the request, not after.** A process that dies mid-call still
leaves the evidence of a call that may have been billed, and that `pending` row counts
against the caps, because a budget that forgives what it cannot see is not a budget.
`generated` and `policy_refused` count too; `error` and `refused` do not, since a network
outage is not a purchase.

Each row carries provider, model, timestamp, outcome, byte count, path, cost estimate and
where the estimate came from, the credential variable's **name**, and the prompt with its
SHA-256 and its declared provenance. That last part answers the hazard of a prompt
assembled from a file, a page, or a repository: `source` is a required tool argument, so
what was forwarded to a third party under the user's credential is reconstructible.

### Content policy

A refusal is reported plainly and **never retried with a reworded prompt** — that would be
the assistant negotiating with a provider's policy on the user's account and the user's
money. This is enforced rather than requested: the gate compares each new prompt against
prompts the provider recently refused and blocks recognisable rewordings locally, before
any socket opens, so a reworded retry cannot cost money even if it is attempted. A
genuinely different request passes untouched.

### Where images go

`<dataDir>/images/`, beside the `renders/` directory, honouring `SELF_EXPRESSION_HOME`.
The reply carries **the path, never the bytes**. Because the bytes are downloaded and
stored locally, the panel can serve them from its own origin and `img-src 'self'` stays
intact; hotlinking a provider CDN would have cost a CSP exception per provider.

A generated image is an **artifact with a ledger row**, not an expression channel: it is a
large binary produced by a third party and billed to the user — evidence of an act rather
than the content of one. The assistant can still `express` about having made it, and the
dwelling can `keep` the path.

&nbsp;

&nbsp;

## Test status

<table>
  <tr>
    <th></th>
    <th>Count</th>
    <th>Statement</th>
    <th>Branch</th>
    <th>Func</th>
    <th>Line</th>
  </tr>
  <tr>
    <th>Unit</th>
    <td>{{unittestcount}}</td>
    <td>{{coverage}}<small>%</small></td>
    <td>{{unitbranch}}<small>%</small></td>
    <td>{{unitfunc}}<small>%</small></td>
    <td>{{unitline}}<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>{{stochtestcount}}</td>
    <td>{{stochcoverage}}<small>%</small></td>
    <td>{{stochbranch}}<small>%</small></td>
    <td>{{stochfunc}}<small>%</small></td>
    <td>{{stochline}}<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>{{doccoverage}}<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>{{docblockcount}}</td>
    <td>{{doccoverage}}<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
