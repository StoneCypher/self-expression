# ASCII renderers — design

2026-08-27 · closes issue #26 ("Implement the visuals vocabulary as renderers, not prose")

## Goal

Every visual form in the status-checklist vocabulary becomes a pure TypeScript renderer:
data in, exact string out. The forms are currently specified in prose, drawn by hand, and
validated by nobody (or, for the summary line, validated after the fact by a checker that
re-derives the arithmetic). A renderer prevents the error class instead of detecting it.

Normative sources, vendored into this repo at `src/doc_md/reference/`:

- `visuals.md` — the ~18 visual forms, with their glyph ramps and scale rules
- `markers.md` — the checklist marker vocabulary and its canonical ordering
- `status-checklists-skill.md` — the summary-line specification (counts, percent,
  anti-aliased progress bar, icon-list sorting and layout)

These vendored copies are the contract. Where this spec pins arithmetic it is restating
them; where this spec is silent, they decide.

## Non-goals

- **Inline math** (`visuals.md` § Inline micro-visualizations) is notation guidance with
  no data→glyph function. It stays prose; no renderer.
- No PNG rendering (issue #7), no diagram language (issue #19).
- No changes to the existing `express` / `recall` / `turn_signed` / `configure` tools.
- No skill-file rewrites yet; the list-expression skill that supersedes
  `~/.claude/skills/status-checklists` is separate follow-on work.

## Architecture

New directory `src/ts/charts/`, reserved for this purpose in `src/doc_md/plugin-layout.md`.
Everything in it is pure: no I/O, no store access, no clock, no randomness. The MCP layer
wraps it; tests exercise it directly; Stryker mutates it.

### `charts/scale.ts` — shared arithmetic

The module every other renderer leans on. Exports (names indicative):

- `EIGHTHS: readonly string[]` — `▁▂▃▄▅▆▇█`
- `SHADES: readonly string[]` — `░▒▓█`
- `BRAILLE: readonly string[]` — `⣀⣄⣦⣶⣾⣿`
- `absoluteIndex(percent, steps)` — `floor(percent ÷ (100/steps))` clamped to
  `[0, steps-1]`. For the 8-glyph ramp this is the normative
  `floor(percent ÷ 12.5)` capped at 7.
- `relativeIndex(value, min, max, steps)` — series-relative normalization; lowest → first
  glyph, highest → last. A flat series (min = max) renders all-first-glyph, not NaN.
- `boundaryGlyph(fraction)` — the anti-aliasing rule: `f < 0.17 → ░`,
  `0.17 ≤ f < 0.5 → ▒`, `0.5 ≤ f < 0.83 → ▓`, `f ≥ 0.83 → █`.
- `barCells(percent, cells = 10)` — full `█` cells, one `boundaryGlyph` cell, `░` padding;
  always exactly `cells` characters. 32% → `███▒░░░░░░`, 67% → `██████▓░░░`,
  100% → `██████████`.

### `charts/markers.ts` — the checklist marker vocabulary

`markers.md` and the SKILL.md bucket lists promoted to code, in the exact pattern of
`channels/vocabulary.ts`: exported `const` arrays feeding validation and rendering.

- `SUCCESS_MARKERS`, `FAILURE_MARKERS` — per the summary-line spec (SKILL.md § The summary
  line). Everything else classifies active+pending.
- `CANONICAL_ORDER: readonly string[]` — every marker in `markers.md` listed order (status
  markers first in listed order, then topic/action markers group by group), with the
  documented exception that **for tiebreak purposes 💯 ranks just after ✅**.
- `classifyMarker(marker, override?)` — bucket for a marker; unknown markers are
  active+pending. `override` exists for 🛳️, whose bucket depends on whether the deploy
  completed — a fact the glyph cannot carry.

### Renderer modules

Grouped by input shape. Every renderer returns a `string` (multi-line forms join with
`\n`), throws `RangeError` on data that violates a documented precondition, and names in
the error message what would have been accepted (the `describeVocabulary` style).

**`charts/series.ts`** — a numeric or categorical sequence in, one line out.

- `renderSparkline(series, scale)` — one `EIGHTHS` glyph per point.
  `scale: 'absolute' | 'relative'`; callers with percent series use `'absolute'` (the
  comparable-across-checklists rule). **Fewer than 4 points throws**, and the error points
  at the trend tag as the correct form for 2–3 points.
- `renderBraille(series, scale)` — same contract on the `BRAILLE` ramp.
- `renderWinLoss(outcomes)` — `('pass'|'flaky'|'fail'|'underway'|'queued'|'skipped')[]` →
  `✅ 🟨 ❌ 🟦 ⬛ 🟧`, oldest to newest, no separators.

**`charts/bars.ts`** — one value (or one small stat set) in, one bar out.

- `renderProgressBar(percent)` — `barCells(percent, 10)`, no brackets.
- `renderBullet(value, target, max, cells = 10)` — filled cells for `value/max` drawn
  with the left-block ramp of the vendored example (`▉` full cells, the boundary cell the
  nearest of `▏▎▍▌▋▊▉`), `░` padding, and a `│` tick replacing the `target/max` cell.
- `renderDiverging(value, maxAbs, cellsPerSide = 6)` — `┃` center; the bar grows left for
  negative, right for positive, boundary cell anti-aliased via `boundaryGlyph`, `░`
  padding both sides. Always `2 × cellsPerSide + 1` characters.
- `renderStacked(success, activePending, failure, width = 16)` — proportional `█` / `▓` /
  `▒` segments by largest-remainder allocation; always exactly `width` characters; every
  nonzero bucket gets at least one cell.
- `renderRange(value, min, max, style)` — `▕`…`▏` borders; `style: 'fill'` shades up to
  the value (`▕▓▓▓▓░░░░░░▏`), `style: 'marker'` places one `●` (`▕░░░●░░░░░░▏`); inner
  width 10.
- `renderBoxWhisker({min, q1, median, q3, max}, width = 16)` — `├`/`┤` whisker ends, `─`
  whisker fill, `┨`/`┠` box walls, `▓` box fill, `┃` median, positions scaled to `width`.
  Throws unless `min ≤ q1 ≤ median ≤ q3 ≤ max`.

**`charts/rows.ts`** — labeled rows in, a block out.

- `renderComparison(rows, width = 20, form = 'bar')` — `rows: {label, value, max?}[]`;
  shared `max` defaults to the row maximum. `'bar'` gives `█`-fill/`░`-pad bars,
  `'dot'` gives the Cleveland form (`●` on a `░` track). Labels pad to the longest;
  values render right of the bar (`80%` when max is 100, raw value otherwise).
- `renderTileGrid(rows, fill)` — `rows: {label?, value?, glyph?}[][]` (null cell = gap).
  `fill: 'abbr-shade'` → `label + SHADES[relative or absolute index]` plus the
  `low ░ ▒ ▓ █ high` legend line; `'custom'` → each cell's `glyph` verbatim;
  `'color-keyed'` → one of `🟥🟧🟨🟩🟦` by value quintile; `'pixel'` → same squares with
  `⬛` for null cells, no labels.

**`charts/timeline.ts`** — ordered stages in, a rail out.

- `renderTimelineRail(milestones)` — `{label, state: 'reached'|'current'|'future'}[]` →
  the two-line monochrome form: `●`/`◆`/`○` on a `━` rail, each marker centered over its
  label, rail spanning the label row's full width.
- `renderTimelineColored(milestones)` — states plus `'failed'` → one line,
  `🟢`/`🟦`/`🔶`/`◎` + label, joined ` ━━ `.
- `renderDependencyChain(steps, currentIndex)` — steps joined ` ━ `, the current step's
  characters underlined with combining U+0332.
- `renderFsl(transitions, activeState?)` — `{from, to, action?}[]` → one-line FSL:
  `from 'action' -> to;` chains merged where they connect, `;` between statements, the
  active state wrapped in `**`.

**`charts/glyphs.ts`** — one datum in, a few characters out.

- `renderTrendTag(text, direction)` — `direction: 'up'|'down'|'rising'|'falling'|'steady'`
  → `▲ ▼ ↗ ↘ →`, e.g. `32% ▲`, `latency 84ms ↘`.
- `renderStars(score, max = 5)` — `★` fill, `☆` remainder, `½` only on a genuine
  half-step. Throws when `score > max` or negative.
- `renderRetryHealth(available, spent)` — `❤️` × available then `🩶` × spent.
- `renderWeather(health)` — closed vocabulary `'all-green'|'mostly-green'|'mixed'|
  'failing'|'broad-failure'|'flaky'|'crashing'|'stalled'|'recovered'` →
  `☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌫️ 🌩️ ❄️ 🌈`.

**`charts/checklist.ts`** — the summary line, computed instead of imitated.

- `renderChecklistSummary(items, options?)` — `items: {marker, bucket?}[]` (one entry per
  checklist item at any nesting level; `bucket` overrides classification, for 🛳️).
  Computes, per the SKILL.md rules:
  - the count section `success/activePending/failure` (always all three, always summing
    to the total),
  - `P = round(100 × success / total)` and ` items (P%)`,
  - the 10-cell anti-aliased progress bar via `barCells`,
  - optionally ` trend <sparkline>` when `options.series` has ≥ 4 points,
  - the per-marker icon list: nonzero markers as `emoji count` joined by two spaces,
    sorted by count descending then `CANONICAL_ORDER`; inline after the bar when ≤ 8
    distinct markers, otherwise a separate block below a blank line, split into up to
    three bucket lines (success / active+pending / failure, empty buckets omitted), at
    most 12 entries per line with overflow wrapping, and blank lines between bucket lines
    when any bucket wrapped.
  Returns the full multi-line block. This makes `check-checklist.mjs`'s count/sort/bar
  assertions unnecessary for tool-rendered output.

### `charts/index.ts`

Re-exports the public renderer surface. `src/ts/index.ts` adds
`export * from './charts/index.js'` so the renderers are also library API.

## MCP surface

New module `src/ts/mcp/chart_tools.ts`, `registerChartTools(server, store)`, called from
`buildServer` alongside `registerTools`. Six tools, grouped by data shape; each takes a
`form` enum built with the same `tuple()`/`z.enum` machinery as `express`, so a
misspelled form is unnameable rather than runtime-rejected.

| tool | forms | notes |
|---|---|---|
| `render_series` | `sparkline` · `braille` · `winloss` | `data: number[]` or `outcomes: string[]`; `scale` defaults `absolute`. Alternatively `seriesKey: string` — the tool resolves it to the stored percent history of logged checklist snapshots (entries where `series_key` matches and `percent` is non-null, in id order) and feeds the pure renderer. |
| `render_bar` | `progress` · `bullet` · `diverging` · `stacked` · `range` · `boxwhisker` | per-form numeric fields, all described |
| `render_rows` | `comparison` · `tilegrid` | rows/grid as structured arrays |
| `render_timeline` | `rail` · `colored` · `dependency` · `fsl` | |
| `render_glyph` | `trend` · `stars` · `retry` · `weather` | |
| `render_checklist_summary` | — | `items: {marker, bucket?}[]`, optional `seriesKey`/`series` for the trend sparkline |

Within a grouped tool the per-form required fields are validated at dispatch, and a
violation names the missing field and the form's full requirement — the grouped design's
runtime check carries the schema's usual helpfulness.

`seriesKey` resolution needs one new store helper, `seriesPercents(store, seriesKey)`, in
`channels/entries.ts` beside the other query helpers. Charts have no config gate in v1;
they are always registered.

## Errors

- Renderers throw `RangeError` with messages naming the accepted domain
  ("series needs at least 4 points for a sparkline; use the trend tag form for 2–3").
- The MCP tool layer catches renderer throws and returns the message as tool text
  prefixed `error: ` — matching `configure`'s existing error style — never a protocol
  fault.

## Testing

- **Unit specs** (`src/ts/tests/*.spec.ts`, one per charts module): exact-string
  expectations pinned at the threshold edges — the 12.5-multiples of the absolute scale,
  the 0.17/0.5/0.83 boundary fractions, `barCells` at 0/32/67/100, the 8-vs-9 icon-list
  split, the 12-entry wrap. Example strings in the vendored prose are the contract for
  the arithmetic forms — the progress bars, sparkline mapping, stacked bar, range
  slider, diverging bar, and the SKILL.md summary-line example block must render
  byte-identical. For the hand-drawn layout forms (timeline rail centering, tile grids,
  box-whisker) the stated rules are the contract and the renderer's output becomes the
  normative drawing; tests pin the rules, not the hand sketch.
- **Stochastic specs** (`*.stoch.ts`, fast-check): bar width constant for all percents;
  fill monotone nondecreasing in percent; sparkline length equals series length; count
  section partitions and sums; icon list sorted by (count desc, canonical order); stacked
  bar always `width` cells; diverging bar always `2n+1` cells; box-whisker ordering
  invariant.
- **Mutation**: `stryker.config.json` `mutate` narrowed to `src/ts/charts/**` per the
  standing note in `plugin-layout.md`; remains opt-in (`ci.stryker: false`).
- **MCP layer spec**: one spec exercising each tool through `buildServer` against a temp
  store, including `seriesKey` resolution and the error path.

## Documentation

- Every export carries a DocBlock: one-line summary, parameter meaning/constraints/units
  where non-obvious, at least one realistic `@example` showing exact output, `@throws`
  where preconditions exist, `@see` to the vendored reference doc section.
- README gains a Charts section listing the six tools and the renderer library surface
  (via the README source the build's madlibs step consumes, not the generated file).
- `plugin-layout.md`'s tree comment for `src/ts/charts/` stays accurate as written.

## Sequencing

`scale.ts` and `markers.ts` first (everything depends on them), then the six renderer
modules in parallel, then `chart_tools.ts` + store helper, then docs/README. Tests ship
with each module, not after.
