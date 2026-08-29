# Card type queue

Five agents at a time; the next queued type is dispatched the moment one returns. This file is
the queue's only record — a dispatch that exists solely in a conversation is a dispatch that is
lost the next time the context is summarised.

Contract for every type is in `cardkit/types/` — read `kit.js` and `kit.css` first, emit
`{ json, html, css, js }` from `build({ id, title, data, ord })`, tokens only, both themes,
classic-script JS, and a throwaway node assertion script that is deleted after it passes.

## In flight

- [x] `markdown` — arbitrary text, node-side subset renderer, escaped
- [x] `molecule` — 3D ball-and-stick, gentle spin, hand-rolled projection
- [x] `clock` + `weather` — gear settings, `Intl` zones, open-meteo through `/net`
- [x] `news` + `rss` — shared feed parser, allowlisted hosts, injection-tested
- [x] `chart` + `graph` — hand-drawn SVG, deterministic force layout

## Queued — the shapes tonight's hand-written cards turned out to be

- [ ] `choice` — n candidates at decision size, click to keep, read the picks back  (was: the icon lab)
- [ ] `rail` — ranked, capped, refills from a bench                                  (was: tickets I'd pick up next)
- [ ] `matrix` — items x attributes, both axes seriated by barycentre sweep           (was: the tracker)
- [ ] `flow` — sankey; nodes and weighted edges, columns summing equal                (was: the funds card)
- [ ] `ledger` — rows with markers and per-row verbs                                  (was: inbox tasks and PRs)
- [ ] `formula` — TeX blocks with a role-to-colour map                                (was: the four equation cards)
- [ ] `ribbon` — timestamped events bucketed by hour, coloured by dominant class      (was: the day ribbon)

## Queued — recommended and adopted

- [ ] `table` — sortable, filterable, typed columns
- [ ] `diff` — a hunk with +N/-M and collapsible context
- [ ] `agentboard` — what is dispatched, what returned, how long each has been out
- [ ] `logtail` — a live-following window on a file or task, with a filter
- [ ] `audit` — the audit log as a readable stream
- [ ] `heatmap` — a year of days, GitHub-style; the ribbon's long view
- [ ] `map` — GeoJSON outlines, hand-projected, no tiles and no key
- [ ] `image` — a local image or a small gallery
- [ ] `note` — an editable scratch card that persists
- [ ] `timer` — countdown and pomodoro, wired to the audio channel
- [ ] `snippet` — a command with a copy button and its last output
- [ ] `countdown` — to a release, a deadline, a date

## Chart and graph types, from the D3 galleries (2026-08-29)

Read from `d3-graph-gallery.com` and Observable's `@d3/gallery` rather than from memory. Their
taxonomy is the useful part: charts sort by the QUESTION they answer, not by their shape.

### In flight
- [x] distribution — `histogram` `boxplot` `violin` `ridgeline` `beeswarm`
- [x] part of a whole — `treemap` `sunburst` `pack` `icicle` `pie`
- [x] relationship — `chord` `arc` `parallel` `splom` `radar`

- [x] evolution — `streamgraph` `horizon` `bump` `slope` `stackedarea`

### Next — dispatched only on request; 56 types is already a lot
- [ ] **merge question**: `stackedarea`'s absolute mode duplicates `chart` with `kind: 'area',
      stacked: true`. Its author said so plainly rather than hiding it, and put the argument in the
      file's DocBlock. What is NOT duplicated: percent mode's exact-hundred construction, the
      absolute-total strip, x-alignment across series with different x sets, ordering, and a caption
      that names what percent mode hides. The merge is small; it needs a decision, not more code.
- [ ] ranking — `lollipop` `circularbar` `dotplot` `marimekko` `funnel`
- [ ] correlation — `hexbin` `contour` `correlogram` `bubble` `connectedscatter`
- [x] geographic — `choropleth` `bubblemap` `spikemap` `cartogram`, on an extracted `_geo.mjs`.
      The extraction is the point: the mercator clamp, the antimeridian split, the pole closure and
      the limb stitching were got right once, in `map.mjs`, and a second copy would drift silently —
      the coastline simply wrong on one card and right on another, with nothing to report it. The
      refactor carries a byte-identical-output proof so it stays a refactor.
- [ ] one-value — `gauge` `bullet` `sparkbar` `progressring`
- [ ] time — `gantt` `timeline` `calendar` (heatmap covers the year grid; these are the others)

### Already covered by an existing type, deliberately not duplicated
`line` `area` `bar` `column` `scatter` (chart) · `sankey` (flow) · `network` (graph) ·
`calendar heatmap` (heatmap) · `donut` (portfolio, and now `pie`) · `candlestick` (candles) ·
`wordcloud` — skipped on purpose: area encodes nothing, and the layout is the only interesting part.

## Queued — finance and code

- [ ] `candles` — OHLC candlesticks with a volume lane; wicks, bodies, up/down by token
- [ ] `ticker` — a strip of symbols: last, change, day sparkline
- [ ] `portfolio` — holdings with allocation and unrealised P&L
- [ ] `waterfall` — the contribution bridge; the one chart finance actually needs and nobody has
- [ ] `code` — a syntax-highlighted snippet: line numbers, copy button, a hand-written lexer for
      a handful of languages, because the CSP forbids a highlighting library and a regex lexer
      good enough for a card is a couple of hundred lines

## After the cards — MCP portability (approved 2026-08-29)

Everything that makes this a practice rather than an API currently rides two Claude-only
channels: the hooks and the skills. On any other host the tools all work and nothing asks for
them, and nothing teaches the vocabulary. These three move the practice onto the protocol.

- [ ] **Conventions over MCP.** Carry the skill text on the `initialize` handshake's
      `instructions`, or expose it as MCP resources. Precedent exists and is proven: onboarding
      already rides `instructions` specifically so it reaches every host.
- [ ] **A `begin_turn` tool.** Lets a hookless agent volunteer what `UserPromptSubmit` would have
      recorded — cwd, project, branch, prompt id. One call instead of a hook, which restores the
      situational metadata the charts and the PNG filter on.
- [ ] **Degrade loudly.** `recall` should say "no turn context recorded on this host" rather than
      returning rows with a null situation, which reads as "nothing was happening". `turn_signed`
      already does this correctly — it answers `unknown` — so follow its example.

## Deliberately not built

- `embed` / `iframe`. It would be the fastest way to get anything onto the desk and it would
  quietly undo the CSP posture that lets the desk render other people's text at all. The whole
  safety story here is that a card cannot reach the network except through an allowlisted proxy;
  an iframe hands that away in one line.
