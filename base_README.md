# self-expression v{{version}}

> Version {{version}} was built on {{built_text}} `{{built}}` from hash `{{gh_hash}}`.

TODO Put the project description here, please.

<!-- Supported embeds: {{built}} {{built_text}} {{coverage}} {{docblockcount}} {{doccoverage}} {{gh_hash}} {{stochbranch}} {{stochcoverage}} {{stochfunc}} {{stochline}} {{stochtestcount}} {{testcasecount}} {{unitbranch}} {{unitfunc}} {{unitline}} {{unittestcount}} {{version}} -->



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

Readers are tolerant: a stored value that fails validation behaves as unset, so a
hand-edited database or a downgrade can never wedge the server or the gates. The
privacy and `time.hook` switches additionally act only on the exact string `false` —
an ambiguous value records rather than silently suppressing.

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
`extractChecklistBlock` and `parseSummaryCounts`) from the same charts barrel.

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
    <td>{{unittestcount}}</td>
    <td>{{coverage}}<small>%</small></td>
    <td>{{unitbranch}}<small>%</small></td>
    <td>{{unitfunc}}<small>%</small></td>
    <td>{{unitline}}<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>{{stochtestcount}}</td>
    <td>{{coverage}}<small>%</small></td>
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
