# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787928740359` from hash `4b4cf6f`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787928740359 Friday, August 28, 2026 at GMT-07:00 91.59 170 88 4b4cf6f 50.29 64.8 56.07 63.83 62 679 86.07 86.66 91.82 617 0.2.1 -->



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
    <td>617</td>
    <td>91.59<small>%</small></td>
    <td>86.07<small>%</small></td>
    <td>86.66<small>%</small></td>
    <td>91.82<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>62</td>
    <td>91.59<small>%</small></td>
    <td>50.29<small>%</small></td>
    <td>56.07<small>%</small></td>
    <td>63.83<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>88<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>170</td>
    <td>88<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
