# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787928660484` from hash `4b4cf6f`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787928660484 Friday, August 28, 2026 at GMT-07:00 90.1 85 84 4b4cf6f 40.55 49.72 47.5 48.63 49 607 86.21 86.25 90.55 558 0.2.1 -->



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
    <td>558</td>
    <td>90.1<small>%</small></td>
    <td>86.21<small>%</small></td>
    <td>86.25<small>%</small></td>
    <td>90.55<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>49</td>
    <td>90.1<small>%</small></td>
    <td>40.55<small>%</small></td>
    <td>47.5<small>%</small></td>
    <td>48.63<small>%</small></td>
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
