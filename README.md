# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787947060757` from hash `66da9d1`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787947060757 Friday, August 28, 2026 at GMT-07:00 94.48 313 90 66da9d1 50.97 64.28 64.68 63.79 146 1662 88.39 92 94.86 1516 0.2.1 -->



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
resolved by a later entry pointing back via `correctsId` with an `outcome` of `hit`,
`miss`, or `void`; calibration is hits ÷ (hits + misses), voids excluded. Any entry
reporting an absence may type its silence: `empty` (looked, found nothing) ·
`unlooked` (did not look) · `held` (withholding pending evidence) · `depth` (beyond
ability to evaluate).

Schema versioning is stored in the database (`schema_version`, currently 4) and
`openStore` migrates older databases stepwise on open, rebuilding tables where a
baked CHECK constraint has to widen; a database newer than the code is refused
rather than downgraded.

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
| `dwelling.enabled` | bool | `false` | Whether the dwelling facility (#45) is active; requires `dwelling.path`. |
| `dwelling.path` | string | *(none)* | Absolute directory the dwelling database lives in. Deliberately no default — the location is the user's explicit offer. |
| `dwelling.size_warn_gb` | int | `10` | Dwelling file size, in gigabytes, at which a visit warns the user. |
| `share.enabled` | bool | `false` | Whether the public-aggregation export is available. Off by default; only the exact value `true` enables — the inverse posture of `privacy.*`. |
| `share.opted_in_utc` | string | *(none)* | The most recent opt-in moment. Stamped automatically when `share.enabled` is set `true`, cleared on opt-out; only rows recorded at or after it are ever exported. |
| `share.time_granularity` | string | `hour` | How far exported timestamps are coarsened: `hour` or `day`. |
| `onboarding.answered` | list | *(none)* | Ids of onboarding questions resolved — answered or explicitly skipped (#40). Unknown ids are preserved, so a newer version's questions survive; unsetting it re-runs onboarding. |

Two of those families reach the *skills*, which are static Markdown and cannot read
configuration at all. The turn-start hook carries them on the context line it already
injects: a `conventions:` segment for the prose toggles, and a `lengths:` segment for
the per-channel text ceilings — rendered against whichever limit the most channels
share, so `lengths: 200 all` is the usual cost and `lengths: 200 except signature:70`
names only genuine deviations. The skill states its *recommended* length (≤70, because
a signature that has to be read has stopped being a glance) as a constant, and takes
its *ceiling* from that segment; a raised ceiling is headroom for the occasional line
that earns it, never an invitation to fill it.

Readers are tolerant: a stored value that fails validation behaves as unset, so a
hand-edited database or a downgrade can never wedge the server or the gates. The
privacy and `time.hook` switches additionally act only on the exact string `false` —
an ambiguous value records rather than silently suppressing. `share.enabled` inverts
that: only the exact string `true` enables, and anything else means no.

&nbsp;

&nbsp;

## Onboarding

Several features are durably toggleable and default off precisely because they are
matters of taste, size, or consent. On a fresh database the server's MCP handshake
says onboarding is pending, and the assistant offers a short questionnaire — at a
natural pause, never interrupting the work: the party roster, forecasts, visible
revision, the ⭑ salience glyph, the taste line, the gift register, the dwelling (which
requires a directory of your choosing — there is deliberately no default path), and
trimming the channel set.

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
| `render_diagram` | `state` \| `digraph` \| `tree` \| `sequence` | A state machine (from structured edges or FSL-subset source, cycles drawn as return arrows, the active state marked `▶`), a directed graph (dependencies, call flows, lineage), a strict hierarchy as a connector tree, or a sequence diagram (actors, lifelines, one arrow row per message). |

When to reach for it: **quantities** (how much, how many, trend) → a chart tool;
**linear order** (a pipeline, one path through states) → `render_timeline`'s inline
forms; **topology** — the moment structure branches, merges, cycles, or fans in or
out — → `render_diagram`. Output is framed, single-width, at most 78 columns, and
meant to sit inside a ```` ```text ```` fence. A graph too large or too tangled to
draw legibly is refused with the fallbacks named in the error text (the FSL
one-liner, an adjacency list, or the mermaid export). `emit: 'mermaid'` /
`emit: 'both'` serialize the graph as `stateDiagram-v2` or `flowchart` source — an
opt-in export for destinations that render mermaid (GitHub PR bodies, READMEs),
never the in-transcript form, since the transcript surface shows mermaid as raw text.

The renderers (`renderStateDiagram`, `renderDigraph`, `renderTree`, `renderSequence`),
the FSL-subset parser (`parseFsl`, round-trip compatible with `renderFsl`), and the
mermaid serializer (`toMermaid`) are all exported from the library
(`self-expression`'s `src/ts/diagrams/index.ts`), for use outside MCP.

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
| `user` | global | the human, via the CLI; the model may relay but never receipts | the per-turn line shows a count |
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
    <td>1516</td>
    <td>94.48<small>%</small></td>
    <td>88.39<small>%</small></td>
    <td>92<small>%</small></td>
    <td>94.86<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>146</td>
    <td>94.48<small>%</small></td>
    <td>50.97<small>%</small></td>
    <td>64.68<small>%</small></td>
    <td>63.79<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>90<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>313</td>
    <td>90<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
