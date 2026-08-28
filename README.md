# self-expression v0.2.1

> Version 0.2.1 was built on Thursday, August 27, 2026 at GMT-07:00 `1787896241392` from hash `e532289`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787896241392 Thursday, August 27, 2026 at GMT-07:00 85.11 71 87 e532289 25.98 38.99 35.36 38.25 40 479 85.64 79.87 85.63 439 0.2.1 -->



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
    <td>439</td>
    <td>85.11<small>%</small></td>
    <td>85.64<small>%</small></td>
    <td>79.87<small>%</small></td>
    <td>85.63<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>40</td>
    <td>85.11<small>%</small></td>
    <td>25.98<small>%</small></td>
    <td>35.36<small>%</small></td>
    <td>38.25<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>87<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>71</td>
    <td>87<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/self-expression/index.html)
* [Documentation](https://stonecypher.github.io/self-expression/docs/index.html)
* [Builds](https://www.github.com/stonecypher/self-expression/actions)
* [Source](https://www.github.com/stonecypher/self-expression/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/self-expression.svg" />
