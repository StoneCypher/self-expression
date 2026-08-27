# ASCII Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every visual form in the vendored status-checklist vocabulary as pure TypeScript renderers plus six grouped MCP tools, closing issue #26.

**Architecture:** Pure functions in `src/ts/charts/` (data in, exact string out, no I/O); shared arithmetic in `charts/scale.ts` and the marker vocabulary in `charts/markers.ts`; a thin MCP layer `src/ts/mcp/chart_tools.ts` registered from `buildServer`. Tests are exact-string unit specs plus fast-check stochastic invariants.

**Tech Stack:** TypeScript 6 ESM (`.js` import suffixes, `isolatedDeclarations` — every export needs an explicit type annotation), zod 4, `@modelcontextprotocol/sdk`, vitest 4, fast-check.

**Spec:** `src/superpowers/spec/2026-08-27-ascii-renderers-design.md` — read it first; it pins every rule. The vendored normative prose is `src/doc_md/reference/{visuals.md, markers.md, status-checklists-skill.md}`.

## Global Constraints

- Every renderer is pure and synchronous; no store, clock, or randomness anywhere in `src/ts/charts/`.
- Precondition violations throw `RangeError` whose message names the accepted domain (see spec § Errors).
- Every export: DocBlock with one-line summary, `@example` showing exact output, `@throws` where preconditions exist, `@see` to the reference doc. Explicit type annotations on all exports (`isolatedDeclarations`).
- Unit tests in `src/ts/tests/<module>.spec.ts`, stochastic in `src/ts/tests/<module>.stoch.ts`, following the existing files' style.
- Run unit tests with `npx vitest run src/ts/tests/<file> --config vitest.config.ts`; stoch with `--config vitest-stoch.config.ts`. Full check: `npm run just_test`.
- Commit after each task, Conventional Commits style.
- Do not touch version numbers, `dist/`, or generated files.

---

### Task 1: `charts/scale.ts` — shared arithmetic

**Files:**
- Create: `src/ts/charts/scale.ts`
- Test: `src/ts/tests/scale.spec.ts`, `src/ts/tests/scale.stoch.ts`

**Interfaces — Produces:**
```ts
export const EIGHTHS: readonly string[];   // ['▁','▂','▃','▄','▅','▆','▇','█']
export const SHADES: readonly string[];    // ['░','▒','▓','█']
export const BRAILLE: readonly string[];   // ['⣀','⣄','⣦','⣶','⣾','⣿']
export function absoluteIndex(percent: number, steps: number): number;
export function relativeIndex(value: number, min: number, max: number, steps: number): number;
export function boundaryGlyph(fraction: number): string;
export function barCells(percent: number, cells?: number): string;   // cells default 10
```

- [ ] **Step 1: Failing tests.** Pin the normative vectors: `absoluteIndex(12.5, 8) === 1`, `absoluteIndex(100, 8) === 7` (capped), `absoluteIndex(0, 8) === 0`; `relativeIndex` lowest→0, highest→steps-1, flat series (min===max) → 0; `boundaryGlyph(0.16)==='░'`, `(0.17)==='▒'`, `(0.5)==='▓'`, `(0.83)==='█'`; `barCells(32)==='███▒░░░░░░'`, `barCells(67)==='██████▓░░░'`, `barCells(100)==='██████████'`, `barCells(0)==='░░░░░░░░░░'`; out-of-range percent (<0, >100, NaN) throws RangeError.
- [ ] **Step 2: Run tests, verify FAIL** (module not found).
- [ ] **Step 3: Implement.** `barCells`: `full = floor(percent/(100/cells))`; if `full < cells`, one `boundaryGlyph` cell for the fractional remainder, then `░` padding to exactly `cells` chars.
- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Stoch invariants** (fast-check): `barCells` length always `cells`; count of `█` monotone nondecreasing in percent; `absoluteIndex` within `[0, steps-1]` for percent in [0,100].
- [ ] **Step 6: Run stoch, verify PASS. Commit** `feat(charts): scale arithmetic — glyph ramps, absolute/relative index, anti-aliased bar cells`

### Task 2: `charts/markers.ts` — marker vocabulary

**Files:**
- Create: `src/ts/charts/markers.ts`
- Test: `src/ts/tests/markers.spec.ts`
- Read first: `src/doc_md/reference/markers.md`, `src/doc_md/reference/status-checklists-skill.md` § The summary line

**Interfaces — Produces:**
```ts
export type Bucket = 'success' | 'active' | 'failure';
export const SUCCESS_MARKERS: readonly string[];   // per SKILL § summary line: ✅ 💯 🏁 👍 😎 ⚠️ (🛳️ only via override)
export const FAILURE_MARKERS: readonly string[];   // ❌ 🚫 🦗 💀 🧟 🦹 🌋 🤬 🤡 😕 🤌 🤥 🥵 😴 🫨 🌗
export const CANONICAL_ORDER: readonly string[];   // every markers.md marker, listed order; 💯 ranks just after ✅
export function classifyMarker(marker: string, override?: Bucket): Bucket;
export function canonicalRank(marker: string): number;  // index in CANONICAL_ORDER; unknown → CANONICAL_ORDER.length
```

- [ ] **Step 1: Failing tests.** `classifyMarker('✅')==='success'`, `('❌')==='failure'`, `('🔜')==='active'`, unknown emoji → `'active'`, `classifyMarker('🛳️','success')==='success'`; `canonicalRank('💯') === canonicalRank('✅') + 1`; every SUCCESS/FAILURE marker appears in CANONICAL_ORDER; no marker in both bucket arrays.
- [ ] **Step 2: FAIL. Step 3: Implement** — transcribe every marker from `markers.md` in its listed order into `CANONICAL_ORDER` (status markers first in listed order, then topic/action group by group), inserting 💯 immediately after ✅ for rank purposes.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(charts): checklist marker vocabulary as code`

### Task 3: `charts/series.ts` — sparkline, braille, win/loss

**Files:**
- Create: `src/ts/charts/series.ts`
- Test: `src/ts/tests/series.spec.ts`, `src/ts/tests/series.stoch.ts`

**Interfaces — Consumes:** Task 1 (`EIGHTHS`, `BRAILLE`, `absoluteIndex`, `relativeIndex`). **Produces:**
```ts
export type SeriesScale = 'absolute' | 'relative';
export const OUTCOMES: readonly string[];  // ['pass','flaky','fail','underway','queued','skipped']
export type Outcome = 'pass'|'flaky'|'fail'|'underway'|'queued'|'skipped';
export function renderSparkline(series: readonly number[], scale: SeriesScale): string;
export function renderBraille(series: readonly number[], scale: SeriesScale): string;
export function renderWinLoss(outcomes: readonly Outcome[]): string;  // ✅🟨❌🟦⬛🟧, no separators
```

- [ ] **Step 1: Failing tests.** `renderSparkline([0,12.5,25,100],'absolute')==='▁▂▃█'`; `renderSparkline([5,95,5,95],'absolute')==='▁█▁█'... ` (95→floor(7.6)=7→'█'; 5→0→'▁'); 3 points throws RangeError mentioning "trend tag"; relative: `[10,20,30,40]` → `▁▃▅█`? — compute with `relativeIndex` (lowest→▁, highest→█, linear between: with steps 8, value 20 → round or floor of (10/30)*7 — pin whichever the Task 1 implementation gives and assert it exactly); `renderWinLoss(['pass','pass','fail','flaky','pass','underway','queued','queued'])==='✅✅❌🟨✅🟦⬛⬛'` (the visuals.md example); unknown outcome rejected by type + runtime throw.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Stoch:** output glyph count equals series length (glyph-aware: split by code point); every glyph from the ramp; <4 points always throws.
- [ ] **Step 6: PASS. Commit** `feat(charts): series renderers — sparkline, braille microplot, win/loss strip`

### Task 4: `charts/bars.ts` — six one-value bars

**Files:**
- Create: `src/ts/charts/bars.ts`
- Test: `src/ts/tests/bars.spec.ts`, `src/ts/tests/bars.stoch.ts`

**Interfaces — Consumes:** Task 1 (`barCells`, `boundaryGlyph`, `SHADES`). **Produces:**
```ts
export function renderProgressBar(percent: number): string;          // barCells(percent, 10)
export function renderBullet(value: number, target: number, max: number, cells?: number): string;   // ▉-ramp fill, │ tick; cells default 10
export function renderDiverging(value: number, maxAbs: number, cellsPerSide?: number): string;      // ┃ center; default 6/side
export function renderStacked(success: number, activePending: number, failure: number, width?: number): string;  // █▓▒, width default 16, largest-remainder
export function renderRange(value: number, min: number, max: number, style: 'fill'|'marker'): string; // ▕…▏, inner width 10
export function renderBoxWhisker(stats: {min:number,q1:number,median:number,q3:number,max:number}, width?: number): string; // ├─┨▓┃▓┠─┤, width default 16
```

- [ ] **Step 1: Failing tests.** `renderProgressBar(32)==='███▒░░░░░░'`; bullet: `renderBullet(65, 90, 100)` → 6 full `▉`, boundary from `▏▎▍▌▋▊▉` nearest to 0.5, `░` padding, `│` replacing cell 9 (index `floor(target/max*cells)` clamped to `cells-1`) — compute the exact expected string in the test; diverging: `renderDiverging(50,100,6)` → left 6 `░`, `┃`, 3 `█`, boundary `░▒▓█` for 0.0 remainder — exact string pinned; total length always `2*cellsPerSide+1`; `renderStacked(1,1,2,16)==='████▓▓▓▓▒▒▒▒▒▒▒▒'`; every nonzero bucket ≥1 cell even when its share rounds to 0; `renderRange(3,0,10,'marker')==='▕░░░●░░░░░░▏'` (● at `round((value-min)/(max-min)*(inner-1))`); `renderRange(6,0,10,'fill')==='▕▓▓▓▓▓▓░░░░▏'`; box-whisker with unordered stats throws RangeError.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Stoch:** widths constant; stacked cells sum to width; stacked segment order always █ then ▓ then ▒; diverging grows correct side by sign.
- [ ] **Step 6: PASS. Commit** `feat(charts): bar renderers — progress, bullet, diverging, stacked, range, box-whisker`

### Task 5: `charts/rows.ts` — comparison rows and tile grid

**Files:**
- Create: `src/ts/charts/rows.ts`
- Test: `src/ts/tests/rows.spec.ts`, `src/ts/tests/rows.stoch.ts`

**Interfaces — Consumes:** Task 1 (`SHADES`, `relativeIndex`, `absoluteIndex`). **Produces:**
```ts
export interface ComparisonRow { label: string; value: number; max?: number; }
export function renderComparison(rows: readonly ComparisonRow[], width?: number, form?: 'bar'|'dot'): string;  // width default 20
export interface TileCell { label?: string; value?: number; glyph?: string; }
export type TileFill = 'abbr-shade'|'custom'|'color-keyed'|'pixel';
export function renderTileGrid(rows: readonly (TileCell|null)[][], fill: TileFill): string;
```

- [ ] **Step 1: Failing tests.** Comparison pinned to the visuals.md example: rows `[{label:'schema',value:80},{label:'content',value:55},{label:'media',value:20}]` with shared max 100 render exactly:
  ```
  schema   ████████████████░░░░  80%
  content  ███████████░░░░░░░░░  55%
  media    ████░░░░░░░░░░░░░░░░  20%
  ```
  (labels padded to longest+2 spaces; fill `round(value/max*width)`; `%` suffix only when max is 100; raw value otherwise). Dot form: same geometry, `●` at the fill position on a `░` track. Tile grid `abbr-shade`: cells render `label + SHADES[index]`, rows joined by `\n`, then blank line and legend `low ░ ▒ ▓ █ high`; `pixel`: value quintiles → `🟥🟧🟨🟩🟦`, null cells `⬛`; `custom`: glyphs verbatim; `color-keyed`: squares only, no labels.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Stoch:** every comparison bar exactly `width` cells; label column uniform; tile grid row count preserved.
- [ ] **Step 6: PASS. Commit** `feat(charts): row renderers — multi-row comparison, tile-grid map`

### Task 6: `charts/timeline.ts` — rails, chains, FSL

**Files:**
- Create: `src/ts/charts/timeline.ts`
- Test: `src/ts/tests/timeline.spec.ts`

**Interfaces — Consumes:** nothing from other tasks. **Produces:**
```ts
export type MilestoneState = 'reached'|'current'|'future'|'failed';
export interface Milestone { label: string; state: MilestoneState; }
export function renderTimelineRail(milestones: readonly Milestone[]): string;      // 2 lines; ● ◆ ○; 'failed' throws (monochrome form has no failed glyph)
export function renderTimelineColored(milestones: readonly Milestone[]): string;   // 1 line; 🟢 🟦 🔶 ◎ joined ' ━━ '
export function renderDependencyChain(steps: readonly string[], currentIndex: number): string;  // ' ━ ' joins; current step underlined via U+0332
export interface FslTransition { from: string; to: string; action?: string; }
export function renderFsl(transitions: readonly FslTransition[], activeState?: string): string;
```

- [ ] **Step 1: Failing tests.** Rail: 4 milestones `spec/build/test/ship`, states reached/reached/current/future → line 2 is the labels separated by 4 spaces; line 1 is a `━` rail spanning line 2's exact width with each marker at the column of its label's center (`labelStart + floor((labelLength-1)/2)`); assert both lines' lengths are equal and markers sit at computed columns (derive the expected string in the test from the same column arithmetic, then assert literally). Colored: `[reached, failed, current, future]` → `🟢 spec ━━ 🔶 build ━━ 🟦 test ━━ ◎ ship`. Chain: `renderDependencyChain(['lint','test','build','deploy'], 2)` → `lint ━ test ━ b̲u̲i̲l̲d̲ ━ deploy` (each char of the current step followed by U+0332). FSL: `renderFsl([{from:'locked',to:'unlocked',action:'coin'},{from:'unlocked',to:'locked',action:'push'}],'locked')` → `**locked** 'coin' -> unlocked 'push' -> locked;` (connected transitions chain; the active state bolded at every occurrence... no — bold only the first occurrence; pin that choice in the test); non-connecting transitions become `;`-separated statements.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit** `feat(charts): timeline renderers — rail, colored, dependency chain, one-line FSL`

### Task 7: `charts/glyphs.ts` — micro-glyphs

**Files:**
- Create: `src/ts/charts/glyphs.ts`
- Test: `src/ts/tests/glyphs.spec.ts`

**Interfaces — Produces:**
```ts
export const TREND_DIRECTIONS: readonly string[];  // ['up','down','rising','falling','steady']
export type TrendDirection = 'up'|'down'|'rising'|'falling'|'steady';
export function renderTrendTag(text: string, direction: TrendDirection): string;  // '32% ▲'
export function renderStars(score: number, max?: number): string;                 // ★☆ + ½; max default 5
export function renderRetryHealth(available: number, spent: number): string;      // ❤️×available + 🩶×spent
export const WEATHER_STATES: readonly string[];  // ['all-green','mostly-green','mixed','failing','broad-failure','flaky','crashing','stalled','recovered']
export type WeatherState = 'all-green'|'mostly-green'|'mixed'|'failing'|'broad-failure'|'flaky'|'crashing'|'stalled'|'recovered';
export function renderWeather(state: WeatherState): string;  // ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌫️ 🌩️ ❄️ 🌈
```

- [ ] **Step 1: Failing tests.** `renderTrendTag('32%','up')==='32% ▲'`, `('latency 84ms','falling')==='latency 84ms ↘'` (up ▲ · down ▼ · rising ↗ · falling ↘ · steady →); `renderStars(4,5)==='★★★★☆'`, `renderStars(3.5,5)==='★★★½☆'`, `renderStars(6,5)` throws, negative throws, non-half-step fraction rounds to nearest half; `renderRetryHealth(3,2)==='❤️❤️❤️🩶🩶'`; `renderWeather('mixed')==='⛅'`, `('recovered')==='🌈'`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit** `feat(charts): glyph renderers — trend tag, stars, retry health, weather`

### Task 8: `charts/checklist.ts` — the summary line

**Files:**
- Create: `src/ts/charts/checklist.ts`
- Test: `src/ts/tests/checklist.spec.ts`, `src/ts/tests/checklist.stoch.ts`
- Read first: `src/doc_md/reference/status-checklists-skill.md` § The summary line — every rule there is normative.

**Interfaces — Consumes:** Task 1 (`barCells`), Task 2 (all), Task 3 (`renderSparkline`). **Produces:**
```ts
export interface ChecklistItem { marker: string; bucket?: Bucket; }
export interface SummaryOptions { series?: readonly number[]; }
export function renderChecklistSummary(items: readonly ChecklistItem[], options?: SummaryOptions): string;
```

- [ ] **Step 1: Failing tests.** The SKILL.md example must render byte-identical: items comprising ✅×8, 🤖×4, ⏳×2, 🔜×2, ❗×2, 🌐×1, 🛠️×1, 🤔×1, 🌗×2, ❌×1, 🚫×1 →
  ```
  8/13/4 items (32%) ███▒░░░░░░

  ✅ 8
  🤖 4  ⏳ 2  🔜 2  ❗ 2  🌐 1  🛠️ 1  🤔 1
  🌗 2  ❌ 1  🚫 1
  ```
  Also: ≤8 distinct markers → inline (`4/1/1 items (67%) ██████▓░░░  ✅ 4  🔜 1  ❌ 1`, two spaces between bar and icons and between entries); count section always three numbers summing to total; P = `round(100*success/total)`; empty items throws RangeError; 13+ same-bucket distinct markers → wrap at 12 and blank lines between all bucket lines; `options.series` with ≥4 points appends ``  trend <sparkline>`` (two spaces) after the bar, absolute scale; <4 points → no trend (not an error).
- [ ] **Step 2: FAIL. Step 3: Implement** — sort per icon-list rule: count desc primary, `canonicalRank` tiebreak; bucket assignment via `classifyMarker(marker, bucket)`.
- [ ] **Step 4: PASS. Step 5: Stoch:** generated marker multisets — counts partition and sum; percent in [0,100]; bar always 10 cells; icon entries sorted by (count desc, rank asc); inline iff distinct ≤ 8.
- [ ] **Step 6: PASS. Commit** `feat(charts): checklist summary renderer — counts, bar, sorted icon list`

### Task 9: exports + store series helper

**Files:**
- Create: `src/ts/charts/index.ts`
- Modify: `src/ts/index.ts` (add `export * from './charts/index.js';` keep existing stub exports)
- Modify: `src/ts/channels/entries.ts` (add `seriesPercents`)
- Test: `src/ts/tests/entries.spec.ts` (extend)

**Interfaces — Consumes:** Tasks 1–8 modules. **Produces:**
```ts
// charts/index.ts re-exports every public name from scale, markers, series, bars, rows, timeline, glyphs, checklist
export function seriesPercents(store: Store, seriesKey: string): number[];  // in entries.ts: entries where series_key = key AND percent NOT NULL, ascending id, mapped to percent
```

- [ ] **Step 1: Failing test** for `seriesPercents`: open a temp store (pattern in existing `entries.spec.ts`), record three checklist entries with `seriesKey:'x'` and percents 10/50/90 plus one unrelated entry, expect `[10,50,90]`; unknown key → `[]`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS.** Confirm `recordEntry` already persists `series_key`/`percent` (see its insert list) — if the checklist fields aren't in the insert, add them; the schema columns exist.
- [ ] **Step 5: Commit** `feat(charts): public exports and stored-series lookup`

### Task 10: MCP chart tools

**Files:**
- Create: `src/ts/mcp/chart_tools.ts`
- Modify: `src/ts/mcp/server.ts` (call `registerChartTools(server, store)` in `buildServer`)
- Test: `src/ts/tests/chart_tools.spec.ts`

**Interfaces — Consumes:** Task 9 exports; `tuple()` and `reply()` patterns from `mcp/tools.ts` (copy the tiny helpers locally rather than exporting them if they are file-private). **Produces:** MCP tools `render_series`, `render_bar`, `render_rows`, `render_timeline`, `render_glyph`, `render_checklist_summary`, each with a `form` z.enum built from a `const` forms array, per-form fields optional in schema, validated at dispatch with messages naming the missing field and the form's requirement. Renderer throws are caught and returned as `error: <message>` tool text (never a protocol fault). `render_series` and `render_checklist_summary` accept `seriesKey` and resolve via `seriesPercents(store, seriesKey)`.

- [ ] **Step 1: Failing tests** via `buildServer` + `InMemoryTransport`/direct handler invocation following the existing MCP test pattern (see how `entries.spec.ts` / `hooks.spec.ts` exercise the server; if no in-process MCP call pattern exists, test `registerChartTools` handlers through the `McpServer` callback registry the same way `tools.ts` handlers would be tested — at minimum, factor each tool's handler body as an exported pure `handleRenderX(store, args)` and test those directly). Cases: sparkline via literal data; sparkline via `seriesKey` after recording percents; 3-point series returns text starting `error: `; each tool renders one happy-path form; unknown form is unrepresentable (schema).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit** `feat(mcp): six grouped chart-rendering tools`

### Task 11: mutation config, README, diagnostics, full build

**Files:**
- Modify: `stryker.config.json` (`mutate` → `["src/ts/charts/**/*.ts"]`; leave opt-in flag as-is)
- Modify: README source — find how `npm run update_madlibs` (`src/build_js/update_madlibs.js`) produces README.md; add a Charts section listing the six MCP tools and noting the renderer library exports, in whichever file is actually the source
- Modify: `src/doc_md/plugin-layout.md` — in Unresolved, note the visuals vocabulary is now implemented (issue #26)

- [ ] **Step 1: Update stryker `mutate` globs.**
- [ ] **Step 2: README Charts section** in the true source file.
- [ ] **Step 3: Run `npm run just_test` — all suites green.**
- [ ] **Step 4: Run `npm run build` — completes;** fix anything it flags (eslint runs in build).
- [ ] **Step 5: Check IDE diagnostics on all new files; resolve warnings.**
- [ ] **Step 6: Commit** `chore(charts): narrow stryker to charts; document chart tools`

## Self-review notes

- Spec § non-goals (inline math, PNG, diagrams, skill rewrites) — intentionally no tasks.
- Type names used across tasks: `Bucket` (T2→T8), `SeriesScale` (T3→T10), `Store` (existing), `ChecklistItem`/`SummaryOptions` (T8→T10), `Milestone`/`FslTransition` (T6→T10), `ComparisonRow`/`TileCell`/`TileFill` (T5→T10) — consistent as written.
- T10 depends on T9; T8 on T1+T2+T3; T3/T4/T5 on T1; T2, T6, T7 are independent roots.
