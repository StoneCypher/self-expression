# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787941582619` from hash `db54ef9`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787941582619 Friday, August 28, 2026 at GMT-07:00 94.8 291 91 db54ef9 52.41 68.24 66.79 67.29 109 1204 88.37 92.85 95.21 1095 0.2.1 -->



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

Schema versioning is stored in the database (`schema_version`, currently 2) and
`openStore` migrates older databases stepwise on open, rebuilding tables where a
baked CHECK constraint has to widen; a database newer than the code is refused
rather than downgraded.

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
| `gate.signature` | bool | `true` | Whether the Stop gate blocks a turn that never signed off. |
| `gate.checklist` | bool | `true` | Reserved for the checklist gate; registered so its name and default are settled before anything reads it. |
| `retention.days` | int | `0` | Prune `entries` and `turn_context` rows older than this many days at server startup. `0` never prunes. Pruning deletes; it does not archive. |
| `privacy.store_cwd` | bool | `true` | Record `cwd`, `project`, and `git_branch`. Suppressed at write time — never captured — when exactly `false`. |
| `privacy.store_prompt_len` | bool | `true` | Record the prompt's length. Same write-time suppression. |
| `format.version` | string | `1` | Declarative recording-convention label stamped onto each entry row, so a mid-study upgrade is visible in the data. Not behavioral. |
| `time.hook` | bool | `true` | Whether the per-turn hook injects the clock sentence. Exactly `false` suppresses the clock and only the clock — context recording, the conventions flags, and the open-signature reminder remain. |
| `forecast.enabled` | bool | `true` | Whether the `predicted` confidence ground is offered. Baked into the tool schema at server startup, like `channels.enabled`. |
| `salience.enabled` | bool | `true` | The ⭑ salience-glyph prose convention. Carried to the static skills via the hook context line's `conventions:` segment. |
| `revision.enabled` | bool | `false` | The visible-revision prose convention; same transport. |
| `gifts.enabled` | bool | `false` | The gift register prose convention; same transport. |
| `roster.enabled` | bool | `false` | The party-roster prose convention (#40); same transport. |
| `dwelling.enabled` | bool | `false` | Whether the dwelling facility (#45) is active; requires `dwelling.path`. |
| `dwelling.path` | string | *(none)* | Absolute directory the dwelling database lives in. Deliberately no default — the location is the user's explicit offer. |
| `dwelling.size_warn_gb` | int | `10` | Dwelling file size, in gigabytes, at which a visit warns the user. |
| `share.enabled` | bool | `false` | Whether the public-aggregation export is available. Off by default; only the exact value `true` enables — the inverse posture of `privacy.*`. |
| `share.opted_in_utc` | string | *(none)* | The most recent opt-in moment. Stamped automatically when `share.enabled` is set `true`, cleared on opt-out; only rows recorded at or after it are ever exported. |
| `share.time_granularity` | string | `hour` | How far exported timestamps are coarsened: `hour` or `day`. |

Readers are tolerant: a stored value that fails validation behaves as unset, so a
hand-edited database or a downgrade can never wedge the server or the gates. The
privacy and `time.hook` switches additionally act only on the exact string `false` —
an ambiguous value records rather than silently suppressing. `share.enabled` inverts
that: only the exact string `true` enables, and anything else means no.

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
  and correction edges, under a fresh per-submission salt that is never persisted:
  grouping works within one submission, nothing joins across submissions.
- **Derived** — `local_period` (six-hour band) and `local_dow` (weekday/weekend)
  replace any timezone export; `cctype` and `face` export only when they validate
  against a closed list or as exactly one emoji grapheme, else `NULL`.
- **Excluded** — `text`, `title`, `cwd`, `project`, `git_branch`, `tz`, `agent_type`,
  `context_emoji`, `permission_mode`, `turn_index`, `resolve_by`, and every raw
  identifier.

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
    <td>1095</td>
    <td>94.8<small>%</small></td>
    <td>88.37<small>%</small></td>
    <td>92.85<small>%</small></td>
    <td>95.21<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>109</td>
    <td>94.8<small>%</small></td>
    <td>52.41<small>%</small></td>
    <td>66.79<small>%</small></td>
    <td>67.29<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>91<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>291</td>
    <td>91<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
