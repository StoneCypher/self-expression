# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787929707110` from hash `32c17a7`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787929707110 Friday, August 28, 2026 at GMT-07:00 92.64 85 84 32c17a7 47.77 56 54.73 55.23 62 699 90.34 88.88 92.62 637 0.2.1 -->



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
| `time.hook` | bool | `true` | Whether the per-turn hook injects the clock sentence. Exactly `false` suppresses the clock and only the clock — context recording and the open-signature reminder remain. |
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
  `context_emoji`, `permission_mode`, `turn_index`, and every raw identifier.

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

Six grouped MCP tools render compact ASCII/emoji visuals inline in text, each taking a `form`
field selecting which of its renderers to use:

| Tool | Forms | Purpose |
|---|---|---|
| `render_series` | `sparkline` \| `braille` \| `winloss` | One data series as a compact trend strip: a block-ramp sparkline, a denser braille microplot, or a categorical win/loss strip. |
| `render_bar` | `progress` \| `bullet` \| `diverging` \| `stacked` \| `range` \| `boxwhisker` | A single value, or a small stat set, as a fixed-width bar: plain progress, a bulleted target graph, a diverging over/under bar, a stacked success/active/failure bar, a min-max range slider, or a box-and-whisker five-number summary. |
| `render_rows` | `comparison` \| `tilegrid` | Several values side by side against one shared scale: a multi-row bar/dot comparison, or a tile-grid map of shaded, colored, or custom-glyphed cells. |
| `render_timeline` | `rail` \| `colored` \| `dependency` \| `fsl` | An ordered sequence of stages: a centered monochrome rail, a colored rail (needed for a failed stage), an inline dependency-chain pipeline, or a one-line FSL-style state-machine description. |
| `render_glyph` | `trend` \| `stars` \| `retry` \| `weather` | One small inline glyph: a trend-direction tag, a star rating, a bounded-retry health bar, or a single weather glyph summarizing overall health. |
| `render_checklist_summary` | *(no form — one renderer)* | The full status-checklist summary line: count section, percent, progress bar, optional trend sparkline, and the sorted per-marker icon list. |

Every renderer behind these tools is also exported directly from the library
(`self-expression`'s `src/ts/charts/index.ts`), for use outside MCP.

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
`extractChecklistBlock` and `parseSummaryCounts`) from the same charts barrel.

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
    <td>637</td>
    <td>92.64<small>%</small></td>
    <td>90.34<small>%</small></td>
    <td>88.88<small>%</small></td>
    <td>92.62<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>62</td>
    <td>92.64<small>%</small></td>
    <td>47.77<small>%</small></td>
    <td>54.73<small>%</small></td>
    <td>55.23<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>84<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>85</td>
    <td>84<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
