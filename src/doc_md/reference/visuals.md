# Status checklist — optional visuals and timelines

Use any of these only where the data genuinely supports it, never as decoration.

## Trend sparkline

Optional element of the summary line. Include it only when the series has **four or more snapshots** — fewer is a segment, not a trend, and reads as noise; a one-shot checklist has no series to plot at all. `log-checklist.mjs`'s `series` op supplies the history. (The trend-tag micro-visualization below covers the two-to-three-point case: a value plus a direction glyph.) When present, it follows the progress bar after two spaces, written `trend <sparkline>`. Build it from the eighth-block glyphs `▁▂▃▄▅▆▇█`, one glyph per snapshot in chronological order. **Completion-percent series use the absolute scale**: 0–100% mapped directly onto `▁`–`█` (glyph index = floor(percent ÷ 12.5), capped at 7), so flat reads as flat, every checklist's sparkline is comparable to every other, and a project idling at 95% looks nothing like one idling at 5%. Series without natural bounds (latency, counts) normalize relative to the series instead (lowest → `▁`, highest → `█`).

## Process timeline

When the checklist describes a complete process or plan end to end, the bottom matter may close with a timeline. A timeline may also attach to an individual item that itself represents a complete process — rendered on the line(s) directly beneath that item, indented one level deeper than the item (item content is indented; bottom-matter timelines sit at column 0).

**Two-line monochrome form** — a rail of milestone markers joined by `━`, the rail running the full width of the label row (left edge of the first label to the right edge of the last); short labels on the second line, each marker centered over its label. `●` reached · `◆` current · `○` not yet reached.

```text
━━●━━━━━━━●━━━━━━━◆━━━━━━━○━━
spec    build    test    ship
```

**One-line colored form** — for milestone state in color. Each pip's colored emoji immediately followed by its label, milestones joined by `━━`. Color requires emoji, emoji are double-width, and double-width pips cannot align to a single-width text label row, so the colored form drops the centered-label rail and lives on one line. `🟢` reached · `🟦` current · `🔶` failed · `◎` not yet reached.

```text
🟢 spec ━━ 🔶 build ━━ 🟦 test ━━ ◎ ship
```

Choose the two-line form for the centered rail, or the one-line form for color; monospace does not allow both.

## Multi-row comparison chart

To compare several categories at once — progress across workstreams, counts across groups — give each its own labeled row with a shade bar sized to its value (or a `●` marker on a track, the Cleveland dot-plot form). It attaches beneath the item or group it describes, indented one level deeper, or stands in the bottom matter. Unlike the single-bar visuals (progress bar, stacked bar, bullet graph, diverging bar), this one compares many categories side by side.

```text
schema   ████████████████░░░░  80%
content  ███████████░░░░░░░░░  55%
media    ████░░░░░░░░░░░░░░░░  20%
```

## Tile-grid map (text choropleth)

A true choropleth needs real region shapes, which monospace cannot draw. Use a tile-grid map instead: each region becomes one equal-size cell in roughly geographic position, with the value encoded in the cell. It attaches beneath an item or group (indented one level deeper) or stands in the bottom matter. Four ways to fill a cell:

- **Abbreviation + shade** (default) — a short region label plus a `░▒▓█` shade glyph, e.g. `CA█ OR▒`; keeps both the label and the value legible.
- **Custom character sequence** — any chosen glyph or short sequence per cell, when a bespoke encoding (digits, arrows, symbols) suits the data better than a shade ramp.
- **Colored squares, keyed** — one colored-square emoji per region (`🟥🟧🟨🟩🟦`) for a true hue scale; vivid, but a square carries no label, so the layout must be self-evident or keyed separately.
- **Colored squares, unlabeled pixel grid** — drop labels entirely and let the colored squares double as pixels: the grid becomes a low-resolution raster of the territory's actual shape, colour encoding value, with `⬛` (or blank) for everything outside it. The most image-like form — coarse, so the silhouette reads at a glance, not in detail.

Abbreviation + shade:
```text
WA█ ID▒ MT░ ND░ MN▒
OR▓ NV▒ WY░ SD░ IA▒
CA█ UT▒ CO▓ NE░ MO▒

low ░ ▒ ▓ █ high
```

Unlabeled colored-square pixel grid:
```text
⬛🟩🟨🟨🟧🟩🟩⬛
🟩🟨🟧🟥🟧🟨🟩🟦
🟥🟧🟧🟨🟨🟨⬛⬛
⬛🟧🟥🟨⬛🟨⬛⬛
```

Geography is schematic — equal tiles in approximate positions — a deliberate trade that also avoids the real choropleth's bias toward large, empty regions.

## Inline micro-visualizations

- **Trend tag** — a value plus a direction glyph (`32% ▲`, `latency 84ms ↘`): the lighter cousin of the trend sparkline, for a current-vs-previous delta with no full series.
- **Braille microplot** — `⣀⣄⣦⣶⣾⣿`, a denser sparkline (2×4 dots per character); prefer the plain block sparkline unless the series needs the resolution.
- **Bullet graph** — a progress bar carrying a `│` target tick, `▉▉▉▉▉▉▊░░│░`; in place of the plain bar when the item or run has a meaningful goal value.
- **Diverging bar** — a bar growing both ways from a centered `┃`, `░░▓███┃██▓░░░`; for a quantity above or below a baseline (ahead/behind schedule, over/under budget).
- **Dependency chain** — for an item that is itself an ordered pipeline, its steps inline in the item text joined by `━`, the current step underlined: `lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy`.
- **Inline math** — item text and the lead line may use Unicode math notation where it states a quantity precisely: fractions `½ ⅓ ¾`, exponents `xⁿ`, operators `∑ √ ≤ ≥ ×`.
- **Star rating** — `★★★★☆`, filled `★` for the score, empty `☆` for the remainder; a `½` only when half-steps matter. For a discrete quality, satisfaction, or confidence score.
- **Range slider** — a value's position in a min–max band, hugged by eighth-block borders (`▕` left, `▏` right), as fill `▕▓▓▓▓▓▓░░░░▏` or a `●` marker `▕░░░●░░░░░░▏`.
- **Box-and-whisker** — a distribution on one line, `├──┨▓▓┃▓┠───┤`: `├ ┤` whiskers, `┨ ┠` the interquartile box, `┃` the median. Only when you have a real distribution.
- **Stacked / segmented bar** — one bar of proportional shaded segments, `███████▓▓▓▓▓▓▓▒▒`; maps onto the count buckets — success `█`, active+pending `▓`, failure `▒`.
- **Win/loss strip** — run outcomes oldest to newest: `✅` pass · `🟨` flaky/draw · `❌` fail · `🟦` underway · `⬛` queued · `🟧` skipped — e.g. `✅✅❌🟨✅🟦⬛⬛`. Needs a series.
- **One-line FSL state machine** — for an item with genuine states and transitions, especially branching or cyclic: chained `->` transitions, `;` between statements, optional `'action'` labels, e.g. `locked 'coin' -> unlocked 'push' -> locked;`. One line only.  If a state is known to be active, write that state in bold.
- **Retry health bar** — for an item with bounded retries left: `❤️` per retry available, `🩶` per retry spent, e.g. `❤️❤️❤️🩶🩶`. Pairs with the 🦡 marker.
- **Weather health glyph** — at the end of an item's or group's text, summarizing a test set's health: `☀️` all green · `🌤️` mostly green · `⛅` mixed · `🌧️` failing · `⛈️` broad failure; specials `🌫️` flaky · `🌩️` crashing · `❄️` stalled/hung · `🌈` recovered.

## Diagrams — when structure needs more than a line

Charts express quantities; diagrams express structure. The decision rule
(issue #19, `render_diagram` in `src/ts/diagrams/`):

- **Quantities** (how much, how many, trend) → a chart: the `render_*` forms above.
- **Linear order** (a pipeline, milestones, one path through states) → the inline forms:
  the dependency chain, a timeline rail, or the one-line FSL state machine. A diagram of a
  straight line is a waste of vertical space.
- **Topology** — the moment structure branches, merges, cycles, fans in or out, or has
  meaningfully *shaped* relationships — → `render_diagram`: `state` (a machine with more
  than one path), `digraph` (shared dependencies, a call flow with a decision point, data
  lineage with a join), `tree` (a strict hierarchy), or `sequence` (actors exchanging
  messages over time). Always emit the drawing inside a ` ```text ` fence; it is framed,
  single-width, and at most 78 columns by construction.
- **Too big to draw** — the renderer refuses past its legibility threshold and names the
  fallbacks: the one-line FSL form, a plain adjacency list, or the mermaid export
  (`emit: 'mermaid'`) for a destination that actually renders mermaid, such as a GitHub PR
  body. Never hand-draw what the renderer refused; a wrapped or misaligned diagram is worse
  than no diagram.
