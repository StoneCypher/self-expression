# PNG history rendering — design

2026-08-27 · refs issue #7 ("Render logged history as a PNG for visual review") · proposal, awaiting review

## Goal

The log accumulates for months and there is no good way to *look* at it. Reading it means
pulling hundreds of rows into context — expensive, and poor for spotting shape. This design
adds a renderer that queries the store, draws a chart dashboard, writes a **PNG to disk**,
and returns the **path**. The consumer then `Read`s the file, which produces a native image
block (~1,600 tokens) instead of base64-as-text in a tool result (~15,000–25,000 tokens,
and invisible anyway — see the issue's analysis of anthropics/claude-code#31208 / #53256).
The pattern is fixed: **write the file, then read it. Never return image content over MCP.**

## What history exists to render, and where it lives

Everything is one SQLite database, `~/.self-expression/log.sqlite3` (relocatable via
`SELF_EXPRESSION_HOME`; `src/ts/channels/paths.ts`). The issue's framing of "TSV rows"
predates the store — the TSV loggers were the predecessor system, and this design renders
the SQLite record only. Importing the legacy TSVs is out of scope (a possible follow-on,
noted under Non-goals).

One `entries` table (`src/ts/channels/schema.ts`), one row per expression, discriminated by
`channel` (ten values, `src/ts/channels/vocabulary.ts`). The columns that carry chartable
signal, mapped to the questions the issue says the log should answer:

| question from the issue | columns that answer it |
|---|---|
| do faces cluster by time of day, or by kind of work? | `channel='signature'` rows: `stem` (closed 6-value vocabulary + null), `face` (open emoji), against `ts_local`/`tz` for time-of-day and `project`/`git_branch` for kind of work |
| does `uncertain` spike around particular tasks? | `uncertain` (0/1) against `ts_utc` and `project` |
| is `delta` carrying signal, or just oscillating? | `delta` (`up`/`down`/`steady`) in `id` order per `session` |
| how often is `need` non-null, and is that changing over time? | count of `channel='need'` rows per period, against count of turns (`distinct prompt_id` on signatures) in the same period |

Plus one the issue predates: `channel='checklist'` rows carry `series_key`, `succ`,
`active`, `fail`, `percent` — per-series completion history. `seriesPercents()` in
`src/ts/channels/entries.ts` already replays it, and PR #54 (issue #27) makes
`series_key` a stable id rather than a title, which is exactly what a labeled
multi-series panel needs. This design builds on #54's identity semantics, not against them.

Existing indexes already cover these reads: `idx_entries_channel (channel, ts_utc)` and
`idx_entries_series (series_key, id)`.

Privacy note: `project`/`cwd`/`git_branch` may be absent when `privacy.store_cwd` is off
(`src/ts/channels/privacy.ts`). The "by kind of work" grouping degrades to an "unknown"
bucket rather than failing. The PNG lands in the user's own data directory and is never
transmitted, so free text and paths in it are no more exposed than the database beside it —
but v1 draws **no free text at all** (see composition), which keeps a casually shared
screenshot low-risk.

## Rendering technology

Four families were compared. The constraint that decides it: this project's runtime
dependency footprint is two pure-JS packages (`@modelcontextprotocol/sdk`, `zod`), it must
install cleanly via `npx -y self-expression` on all three hosts, and the machine it
actually lives on is Windows.

**1. node-canvas (`canvas`) — rejected.** Full 2D API and text, but a native module
backed by Cairo. On Windows the prebuilt binaries chronically lag new Node majors, and
building from source needs a GTK/Cairo toolchain — the classic Windows install failure.
An `npx`-launched MCP server that can fail at `node-gyp` on the primary platform is
disqualifying.

**2. Skia bindings (`skia-canvas`, `@napi-rs/canvas`) — rejected, but named as the
escape hatch.** Prebuilt N-API binaries make the Windows story genuinely fine, and they
would bring real text shaping and even color emoji. The cost is tens of megabytes of
platform binary pulled on first `npx` resolution, for a feature used occasionally. If a
future need (emoji faces on the chart, dense labeling) outgrows v1, `@napi-rs/canvas` is
the recommended step — the drawing layer below is shaped so only the surface
implementation would swap.

**3. SVG-to-PNG (`@resvg/resvg-js`, `sharp`) — rejected.** Generating SVG is attractive —
a pure string renderer, exactly the house style of `src/ts/charts/` — but the
rasterization half still drags in a native binary, so it inherits option 2's cost while
adding an intermediate format. And SVG alone does not satisfy the issue: `Read` produces a
native image block for `.png`, not for `.svg`. (Writing a `.svg` *sibling* next to the PNG
is a cheap follow-on, since the panel geometry computed below could serialize to SVG
almost for free; deferred, not designed here.)

**4. Headless browser (Playwright / puppeteer) — rejected.** Hundreds of megabytes and a
browser download step to draw a chart into a file. Out of all proportion.

**5. Pure-JS PNG encoder — chosen.** PNG is a signature, a few length-prefixed chunks
each with a CRC32, and scanlines compressed with deflate. Node provides both halves:
`zlib.deflateSync` (always), and `zlib.crc32` (added in Node v22.2.0). The issue asked
for this to be verified before committing: **verified** — `typeof zlib.crc32 ===
'function'` on the development machine's Node v22.23.1, and since `node:sqlite` requires
≥ 22.5, *any install that can open the store can encode a PNG*; no CRC table fallback is
needed. The encoder is on the order of 100 lines and adds **zero dependencies**, native
or otherwise.

The honest cost of option 5 is text: no font comes for free. Mitigations, in order:

- Panels are chosen so the data reading needs **color and position, not glyphs**
  (punch-strip, lanes, bars, polylines).
- A vendored **5×7 bitmap font covering printable ASCII** (~96 glyphs as bit patterns —
  data, not code) supplies axis ticks, panel titles, and legend labels. Drawn at 2×
  scale it is small but entirely legible; this is the same class of font every
  oscilloscope and BIOS uses.
- **No emoji are rasterized.** Faces and context emoji cannot be drawn without a color
  emoji font stack (options 2/4 territory). Categorical panels encode by **color** with
  an ASCII legend instead; the `stem` column (a closed 6-value vocabulary that exists
  precisely because prefix-matching free text was unanalyzable) is the plotted variable,
  with `face` reserved for a future Skia-backed renderer.

## What the PNG shows

One dashboard image, default 960×720 logical pixels rendered at 2× (1920×1440 physical)
for crispness without anti-aliasing. Fixed light background, dark ink, and the Okabe–Ito
colorblind-safe palette for categorical color. Five panels, one per question:

- **A — stems by time of day** (answers "cluster by time of day / kind of work").
  Punch-strip: x = calendar day across the queried range, y = hour 0–23 (from
  `ts_local`, which the schema stores precisely so local rhythm is recoverable), one
  2×2 dot per signature, colored by `stem` (6 colors + grey for null). Legend lists the
  stems in vocabulary order. A `project` filter parameter re-renders the same panel for
  one kind of work; v1 does not attempt per-project small multiples.
- **B — delta lane** (answers "signal or oscillation"). Signatures in `id` order as
  1px-wide columns colored up=blue / down=vermillion / steady=grey, with a rolling mean
  of (+1/−1/0) over a 20-entry window drawn as a polyline on top. Oscillation reads as
  dense color churn under a flat line; a real drift reads as the line leaving zero.
- **C — uncertainty** (answers "does `uncertain` spike"). Per-day proportion of
  signatures with `uncertain=1`, as a bar strip sharing panel A's x-axis so spikes can
  be eyeballed against what was happening that day.
- **D — need rate** (answers "how often, and is it changing"). Per-ISO-week: turns
  (distinct `prompt_id` among signatures) as a grey bar, `need` rows as an overlaid
  colored bar, and the proportion as a polyline on a right-hand 0–100% scale.
- **E — checklist series** (the post-issue column set). `percent` vs recording order,
  one polyline per series for the five `series_key`s with the most rows in range,
  labeled with the key (ASCII font; keys are stable ids per PR #54). Y fixed 0–100 so
  charts are comparable across renders, matching the absolute-scale rule the ASCII
  sparklines already follow.

Sessions with no data in a panel render the panel frame plus the text `no data in
range` rather than omitting the panel — a missing panel looks like a bug; an empty one
is an answer.

## Architecture

New directory `src/ts/raster/`. It is **not** `src/ts/charts/`, which `plugin-layout.md`
reserves for the pure ASCII renderers and which Stryker mutates as a set; the raster
modules are siblings with the same purity discipline. Everything except the final write
is pure: no I/O, no clock, no randomness.

- **`raster/encoder.ts`** — `encodePng(width, height, rgba)`: RGBA bytes in, PNG
  `Buffer` out. 8-bit truecolor+alpha, filter type 0 (None) on every scanline —
  `deflateSync` at default level compresses flat-color chart rasters well enough that
  smarter filters are not worth their code. Chunks: `IHDR`, one `IDAT`, `IEND`, each
  CRC'd with `zlib.crc32`. Throws `RangeError` when the buffer length is not
  `4·width·height`, naming the expected length.
- **`raster/font.ts`** — `GLYPHS`: the 5×7 bit patterns for printable ASCII, plus
  `measureText(text)`. Pure data.
- **`raster/surface.ts`** — a minimal drawing surface over an RGBA array: `pixel`,
  `hline`, `vline`, `rect`, `fillRect`, `polyline` (Bresenham), `text` (blits `font.ts`
  glyphs at an integer scale), and the palette constants. No clipping surprises: drawing
  clamps to the surface, and panel code draws through a translated sub-view so a panel
  cannot scribble on its neighbor.
- **`raster/panels.ts`** — one pure function per panel (`drawStemPunch`,
  `drawDeltaLane`, `drawUncertainStrip`, `drawNeedRate`, `drawChecklistSeries`): typed
  row arrays in, pixels onto a surface region out. All layout arithmetic (scales, tick
  placement) lives here and is directly testable.
- **`raster/compose.ts`** — `renderHistoryPng(data, options)`: allocates the surface,
  lays out the five panels, returns the encoded `Buffer`. The only inputs are the query
  results and options — this function never touches the store.
- **`channels/entries.ts` gains the query helpers**, beside `seriesPercents`:
  `signatureHistory(store, sinceUtc)`, `needWeekly(store, sinceUtc)`,
  `checklistSeriesTop(store, sinceUtc, n)` — thin, indexed reads returning the typed
  row arrays the panels consume.
- **`raster/index.ts`** — barrel, re-exported from `src/ts/index.ts` so the encoder and
  renderers are library API like everything else.

The single impure step — resolve output path, `mkdir -p` the directory, write the
buffer — lives in the invocation layer below, not in `raster/`.

## Output location and naming

`<dataDir>/renders/history_<utc-stamp>.png` — e.g.
`~/.self-expression/renders/history_2026-08-27T21-15-04Z.png`. Rationale:

- Beside the database it depicts, so `SELF_EXPRESSION_HOME` relocates both together and
  nothing lands in any project tree or scratchpad that a host might clean.
- Timestamped rather than overwritten, so two sessions (or a before/after comparison)
  never race on one filename. Colons become hyphens for Windows.
- No auto-pruning in v1. Renders are ~50–200 KB; a cleanup policy is a one-line follow-on
  once real accumulation is observed, and silently deleting user-visible files is the
  kind of behavior that should be asked for, not defaulted.

An explicit `out` parameter overrides the whole path when the caller wants the file
somewhere specific.

## Invocation

**Both** an MCP tool and a CLI subcommand, as thin wrappers over one function — the model
is the primary consumer, but a chart of months of history is equally something the human
wants from a shell without burning a session on it.

- **MCP tool `render_history_png`**, registered in `src/ts/mcp/chart_tools.ts` alongside
  the six ASCII chart tools (same `tuple()`/`z.enum` machinery; no config gate, matching
  charts). Parameters: `days` (default 90), `chart`
  (`'dashboard' | 'stems' | 'delta' | 'uncertain' | 'need' | 'checklist'`, default
  `dashboard`; single-chart values render that panel alone at full size), `project`
  (filter), `seriesKey` (checklist panel filter), `scale` (`1 | 2`, default 2), `out`.
  Returns **text only**: the absolute path plus a one-line row-count summary, and the
  description ends with the instruction *"then use the Read tool on the returned path to
  view the image"* — encoding the write-then-read pattern in the tool contract itself.
  Errors return as `error: `-prefixed tool text, matching `configure`.
- **CLI subcommand `self-expression render [--days N] [--chart X] [--out P]`** —
  `parseCommand` in `src/ts/cli_commands.ts` gains a `render` kind; the help text gains
  one line. Prints the path to stdout.

## Non-goals

- No image content over MCP, ever — the issue's core finding, restated as a contract.
- No emoji rasterization, no proportional text, no anti-aliasing in v1.
- No SVG/HTML/interactive output (the `.svg` sibling is a noted follow-on, not designed).
- No import of the predecessor TSV logs.
- No terminal inline display — Claude Code's TUI cannot render images
  (anthropics/claude-code#2266 et al.); the user opens the file externally.
- No new native or npm dependency of any kind.
- No changes to the ASCII renderers, the express/recall surface, or the schema — the
  query helpers read existing columns and indexes only.

## Testing

- **`encoder.spec.ts`** — structural: signature bytes, chunk lengths, CRCs recomputed
  independently and matched, `zlib.inflateSync` of the IDAT payload reproduces the
  filter-byte-prefixed scanlines exactly. A fixture: a 4×4 two-color raster's full
  encoded output pinned byte-for-byte. The `RangeError` path.
- **`encoder.stoch.ts`** (fast-check) — for random dimensions and random RGBA content:
  decode-what-you-encoded round-trip through `inflateSync`, IHDR width/height honored,
  every chunk CRC valid. This is a real test, not a fake one: the assertion path
  re-derives scanlines from the input, never from the encoder's own intermediate state.
- **`surface.spec.ts` / `font.spec.ts`** — exact-pixel assertions: Bresenham endpoints,
  rect edges, a rendered `A` matched against its glyph pattern; stochastic: no drawing
  operation ever writes outside the surface.
- **`panels.spec.ts`** — fixture row-sets with known extremes; assert sampled pixels
  (an up-delta column is the up color; the 100%-percent polyline touches the panel top)
  and the `no data in range` path. Stochastic: panels never paint outside their region.
- **MCP/CLI spec** — a temp store seeded through `recordEntry`, tool invoked through
  `buildServer`: file exists at the returned path, starts with the PNG signature, is
  non-trivially sized; `out` override honored; empty store still renders.
- **Stryker** — `mutate` currently narrows to `src/ts/charts/**`; extend to include
  `src/ts/raster/**` (still opt-in, `ci.stryker: false`). Exact-byte encoders and
  threshold-heavy layout arithmetic are precisely the mutation-testing sweet spot, per
  the standing rationale in `plugin-layout.md`.

## Documentation

- DocBlocks throughout per house rules: one-line summary, parameter constraints and
  units, a realistic `@example`, `@throws` on the encoder, `@see` links between
  encoder/surface/panels and to this spec.
- README gains the `render_history_png` tool and `render` subcommand (via the madlibs
  README source, not the generated file).
- `plugin-layout.md`: add `src/ts/raster/` to the tree with a one-line purpose, and
  update the Stryker note.

## Open questions for review

1. Is the five-panel dashboard the right v1, or should v1 ship only panels A–D and defer
   the checklist panel until PR #54's series-key semantics have merged and settled?
2. 90-day default window — too long, too short?
3. Should `render` prune renders older than some age, or is manual cleanup fine? (v1
   position: manual.)
4. Is the `.svg` sibling worth pulling into v1, since panel geometry could serialize both
   ways? (v1 position: no — one output format until the first one is proven.)

## Post-approval implementation checklist

1. `raster/encoder.ts` + `encoder.spec.ts` + `encoder.stoch.ts` — the load-bearing
   novelty, first and alone.
2. `raster/font.ts`, `raster/surface.ts` + specs.
3. Query helpers in `channels/entries.ts` + spec additions (temp store).
4. `raster/panels.ts` + spec/stoch.
5. `raster/compose.ts` + spec; `raster/index.ts`; re-export from `src/ts/index.ts`.
6. `render_history_png` in `mcp/chart_tools.ts` + spec through `buildServer`.
7. `render` subcommand in `cli_commands.ts` / `cli.ts` + spec.
8. Stryker `mutate` extension; README madlibs source; `plugin-layout.md`.
9. Full build green; PR referencing this spec, closing #7.
