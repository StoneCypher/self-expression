# self-expression v0.2.1

> Version 0.2.1 was built on Friday, August 28, 2026 at GMT-07:00 `1787928465757` from hash `4b4cf6f`.

TODO Put the project description here, please.

<!-- Supported embeds: 1787928465757 Friday, August 28, 2026 at GMT-07:00 89.52 85 84 4b4cf6f 46.2 52.48 47.39 51.35 48 595 89.31 85.78 89.6 547 0.2.1 -->



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

Config keys (defaults live in code; the `config` table stores overrides only):

| Key | Default | Effect |
|---|---|---|
| `channels.enabled` | all channels | comma-separated allowlist; a disabled channel vanishes from the tool schema |
| `forecast.enabled` | `true` | `false` bakes the `predicted` ground out of the tool schema |
| `salience.enabled` | `true` | the ⭑ salience glyph convention (carried to skills via the hook context line's `conventions:` segment) |
| `revision.enabled` | `false` | visible-revision prose convention (same transport) |
| `gifts.enabled` | `false` | the gift register (same transport) |
| `roster.enabled` | `false` | the party-roster convention (same transport) |
| `gate.signature` | `true` | `false` disables the Stop-gate signature check |
| `privacy.store_cwd` / `privacy.store_prompt_len` | `true` | `false` suppresses the field at capture |

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
    <td>547</td>
    <td>89.52<small>%</small></td>
    <td>89.31<small>%</small></td>
    <td>85.78<small>%</small></td>
    <td>89.6<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>48</td>
    <td>89.52<small>%</small></td>
    <td>46.2<small>%</small></td>
    <td>47.39<small>%</small></td>
    <td>51.35<small>%</small></td>
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
