# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787929412633` from hash `4b4cf6f`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787929412633 Friday, August 28, 2026 at GMT-07:00 91.59 168 91 4b4cf6f 51.72 64.95 60.99 63.59 63 675 86.84 88.23 92.22 612 0.2.1 -->



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
    <td>612</td>
    <td>91.59<small>%</small></td>
    <td>86.84<small>%</small></td>
    <td>88.23<small>%</small></td>
    <td>92.22<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>63</td>
    <td>91.59<small>%</small></td>
    <td>51.72<small>%</small></td>
    <td>60.99<small>%</small></td>
    <td>63.59<small>%</small></td>
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
    <td>168</td>
    <td>91<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
