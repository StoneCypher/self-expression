# Diagrams as a distinct mechanic — research and design

2026-08-27 · issue #19 ("Diagrams as a distinct mechanic from charts") · proposal awaiting
review, not an implementation

## Goal

Give the plugin a way to draw **structure** — topology, relationships, transitions — with the
same reliability guarantees the charts side gives quantities: data in, exact string out, the
error class prevented rather than detected.

Charts express data; diagrams express structure. The plugin has the former
(`src/ts/charts/`, issue #26 / PR #47) and not the latter. The motivating failure from the
issue: the tri-host plugin layout was described with a markdown table and an ASCII tree, both
lossy, because the interesting fact — three manifests coexisting at one root while `skills/`
converges and `commands/` forks per host — is a graph, and there was no graph primitive to
reach for.

Structure worth drawing that no chart can carry: dependency graphs, state machines, call
flows, data lineage, decision trees, before/after architecture diffs. For this repository in
particular, state and transition diagrams are the owner's native idiom — `jssm`, `fsl-mcp`,
`vscode-fsl`, `fsl-textmate` — and a self-expression plugin that cannot draw one is missing
the owner's primary abstraction.

## Non-goals

- No implementation in this PR. This is the research deliverable the issue's `Needs research`
  label asks for; the implementation checklist at the end is the follow-on work.
- No PNG output (that is issue #7's mechanic, and it deliberately targets *history review*,
  not in-flight structure).
- No change to the existing charts renderers or their MCP tools. `renderFsl` and
  `renderDependencyChain` in `src/ts/charts/timeline.ts` stay where they are; they are
  one-line *inline* forms and remain correct as such.
- No general-purpose graph query language, no persistence of graphs, no interactive output.

&nbsp;

## Why diagrams are a different mechanic, not more charts

The distinction is not cosmetic; nearly every engineering property differs.

| | Charts (`src/ts/charts/`) | Diagrams (proposed `src/ts/diagrams/`) |
|---|---|---|
| Input shape | numbers: a scalar, a series, labeled rows | a graph: nodes, edges, edge labels |
| Core computation | scale arithmetic (`floor(percent ÷ 12.5)`) | layout: layering, ordering, routing |
| Correctness | exact — byte-identical strings pinned at threshold edges | faithful — topology must survive; the drawing itself is one of many acceptable embeddings |
| Failure mode | value out of documented range → `RangeError` | graph too large or too tangled to draw legibly → refuse and name the fallback |
| Output size | one line to a few lines, width fixed by cell count | grows with node count in two dimensions; needs a width budget |
| Mutation testing | ideal target (dense threshold bands) | poor target for layout heuristics; good target for the parser and the grid |

Merging the two into one directory would blur every one of those rows: the Stryker `mutate`
narrowing to `src/ts/charts/**` (chosen precisely because charts are dense exact arithmetic)
would either swallow layout heuristics it is wrong for, or need per-file carve-outs forever.
The test contract also differs: charts pin example strings byte-for-byte; diagram tests must
pin *invariants* (every node drawn once, every edge traceable, frame rectangular) plus a small
set of goldens, because a layout tweak that preserves topology should not break fifty exact
strings. Separate directory, separate contract, same purity rules: no I/O, no store access, no
clock, no randomness.

&nbsp;

## Research: candidate description languages

Four candidates were on the table. The issue opened with mermaid as the presumptive answer and
one open question — whether it renders anywhere in the Claude Code surface. That question is
now settled empirically (issue #19 comment, tested in the VS Code extension surface):
**mermaid does not render; both `stateDiagram-v2` and `sequenceDiagram` blocks came through as
raw source inside a code fence.** That result reorders the whole comparison.

### Mermaid — viable as an export, not as the primitive

For: it is text, so it keeps every property that made ASCII charting the right call (lands in
the transcript, greppable, diffable, loggable to SQLite, host-independent). GitHub renders
` ```mermaid ` fences natively in issues, PRs, and READMEs, and some artifact/preview surfaces
render it too. Its `stateDiagram-v2` dialect is close in spirit to FSL.

Against, and decisive: the reader in the transcript — the surface this plugin exists for —
gets `participant H as Human` instead of a picture. A diagram that must be read *in-flight*
cannot be mermaid. It stays viable exactly where the issue comment left it: "output destined
somewhere with a renderer." So mermaid is demoted to a **secondary emission**: a cheap
`toMermaid(graph)` serializer for when the destination is a GitHub PR body or another
rendering surface, never the in-transcript form.

### FSL / jssm — the input language for state machines, not the renderer

FSL is the owner's own graph-description language and the natural input syntax for the state
machine case: `locked 'coin' -> unlocked 'push' -> locked;` is compact, expressive, already
familiar in this codebase (`renderFsl` *emits* it today), and degrades to readable source
better than any other candidate because it was designed to be read as text.

But FSL is a description language, not a rendering; jssm (the library that draws FSL) is an
npm dependency, and this project deliberately carries zero runtime dependencies —
`node:sqlite` only (see issue #7, which preserved the same constraint for PNG encoding).
Absent that constraint, jssm would be the obvious choice and this section would be shorter.
With it, the honest position is:

- Accept a **small FSL subset as input syntax** — plain and action-labeled transitions, chained
  arrows, `;` statement separators — via a parser of well under a hundred lines, round-trip
  compatible with what `renderFsl` already emits.
- Do **not** attempt jssm's full grammar (probabilities, themes, machine metadata, hooks).
  A caller with a full FSL machine has jssm; a transcript diagram needs the topology.
- Revisit taking jssm as a real dependency if the zero-dependency rule is ever relaxed; the
  parser subset is designed to be throwaway in that world.

### DOT / Graphviz — rejected

DOT the language is fine; Graphviz the renderer is a native binary that cannot be assumed on
any host, and this plugin runs on three hosts on end-user machines including Windows. DOT
source unrendered degrades worse than FSL for a human reader (`rankdir=LR; node [shape=box];`
before any content). Nothing DOT expresses that we need is missing from structured edges +
FSL. Not even kept as an export: mermaid covers the renders-on-GitHub case and FSL covers the
readable-source case, and a third serializer is surface area without a consumer.

### ASCII box-and-arrow — the primitive

The issue comment's conclusion, adopted here as the design's foundation: **ASCII is the
primitive, not the fallback.** It is legible on every surface with no renderer dependency, it
survives copy-paste, and it is the only candidate whose degraded form *is* its rendered form.

Its known weaknesses are exactly what a renderer exists to fix:

- **Hand-drawing is error-prone.** Alignment drift, forgotten arrows, edges that visually
  connect the wrong boxes. Same argument as issue #26: a renderer prevents the error class
  instead of a reviewer detecting it.
- **Ragged right edges** (issue #19 comment, second finding): code blocks background-fill each
  line to its own length, so uneven lines render jagged. Of the two fixes — pad every line
  with trailing whitespace, or frame the diagram in a visible box — **framing is the
  default**. Trailing whitespace is fragile (editors strip it, linters flag it, git hooks
  reject it, `.editorconfig` silently destroys it); a frame is made of visible characters
  nothing can strip, guarantees a rectangle, and is self-verifying because misalignment is
  obvious against the border. Padding remains available (`frame: false` still pads
  internally) for throwaway output. The renderer owns this, exactly as `check-checklist.mjs`
  owns summary-line math.

&nbsp;

## Rendering-compatibility constraints

These are the load-bearing constraints, collected from the charts work and the issue thread;
the design below is shaped by all of them.

1. **Monospace grid, single-width characters only in the drawing surface.** Emoji are
   double-width and misalign columns — the exact reason `visuals.md` splits the process
   timeline into a monochrome rail form and a colored railless form (documented at length in
   `src/ts/charts/timeline.ts`). Diagrams therefore use the light box-drawing set
   (`─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`), arrows (`▶ ◀ ▼ ▲` or ASCII `> < v ^` — see open questions),
   and single-width label text. No emoji inside the frame, ever. Labels containing
   double-width characters are rejected with a `RangeError` naming the constraint rather
   than silently corrupting the grid.
2. **Always emitted inside a fenced code block** (` ```text `). Outside a fence,
   proportional fonts and markdown collapse destroy alignment. Inside one, the diagram keeps
   the transcript properties from the issue: greppable, diffable, loggable to SQLite like any
   other rendered block, identical across Claude Code, Codex, and Gemini CLI.
3. **Width budget.** Default maximum 78 columns (fits an 80-column terminal inside a fence
   without wrapping), configurable. A layout that cannot fit the budget is a refusal with a
   named fallback (below), not a wrapped diagram — a wrapped diagram is worse than no
   diagram.
4. **Framed by default** (see above). The frame costs two lines and four columns and buys a
   guaranteed rectangle out of visible characters.
5. **No trailing whitespace anywhere in output**, framed or not — framed lines end at the
   frame; unframed lines are padded internally and the pad documented as cosmetic, so a
   stripped pad degrades appearance, never meaning.
6. **Glyph conservatism.** Light box-drawing characters render correctly in Windows Terminal,
   VS Code (editor and extension webviews), macOS Terminal, and tmux. Double-line, heavy, and
   rounded variants are less uniform across fonts and buy nothing structural; they are
   excluded from v1.

&nbsp;

## When the assistant should reach for a diagram

Decision guidance, intended to land in the eventual skill text as well as the tool
descriptions:

- **Quantities** (how much, how many, trend) → chart. Existing `render_*` tools.
- **Linear order** (pipeline, milestones, one path through states) → the existing inline
  forms: `renderDependencyChain`, `renderTimelineRail`, or the `renderFsl` one-liner. A
  diagram of a straight line is a waste of vertical space.
- **Topology** — the moment the structure branches, merges, cycles, fans in or out, or has
  meaningfully *shaped* relationships — → diagram. Concretely: a state machine with more than
  one path; a dependency graph with shared dependencies; a call flow with a decision point;
  data lineage with a join; before/after architecture where the *change* is a rewiring.
- **Too big to draw** (past the legibility threshold, see below) → do not draw. Fall back to
  the FSL one-liner or an adjacency list in the transcript, and offer the mermaid emission
  for a rendering surface. The refusal names both options.

The tri-host layout example from the issue lands in the third bucket: three manifest nodes
fanning into one root, `skills/` one shared node, `commands/` forking into two — a
fan-in/fan-out drawing a table cannot carry.

&nbsp;

## Design

### `src/ts/diagrams/` — new directory, same purity rules as charts

Everything pure: no I/O, no store access, no clock, no randomness; deterministic output for
identical input. The MCP layer wraps it; tests exercise it directly.

**`diagrams/model.ts`** — the shared graph model.

- `DiagramNode { id: string; label?: string }` (label defaults to id)
- `DiagramEdge { from: string; to: string; label?: string }`
- `Digraph { nodes: readonly DiagramNode[]; edges: readonly DiagramEdge[] }`
- `normalizeGraph(edges, nodes?)` — builds a `Digraph` from an edge list, inferring nodes,
  rejecting dangling references, duplicate ids, and self-referencing labels that would break
  the grid (double-width characters, embedded newlines).

**`diagrams/fsl.ts`** — the FSL subset parser.

- `parseFsl(source): Digraph` — accepts the subset `renderFsl` emits: bare transitions
  (`a -> b;`), action-labeled transitions (`a 'action' -> b;`), chained arrows
  (`a -> b -> c;`), multiple `;`-separated statements. Actions become edge labels.
- Round-trip property: `parseFsl(renderFsl(t))` yields the same edge multiset as `t` (modulo
  the active-state `**bold**` marks, which the parser strips).
- Everything outside the subset — probabilities, `machine_name:`, themes — is a `RangeError`
  naming the subset, not a silent skip.

**`diagrams/grid.ts`** — the character grid.

- A mutable width×height cell buffer with `set`, `hline`, `vline`, `box`, `text`, and
  box-drawing **junction resolution** (writing `─` across an existing `│` yields `┼`, etc. —
  the one piece of cleverness the whole drawing layer shares).
- `frame(grid)` — wraps in the visible border; `render(grid, { frame })` — joins to the final
  string, framed by default, internally padded and trailing-whitespace-free either way.

**`diagrams/layout.ts`** — layered layout for digraphs (deliberately modest).

- Longest-path layering; cycles handled by marking back edges (drawn as return edges, never
  used for layering, so a two-state toggle draws as two boxes with a forward and a return
  arrow rather than recursing).
- Barycenter ordering within layers to reduce crossings — a heuristic, explicitly not
  optimal, pinned by invariant tests rather than exact strings.
- Orthogonal edge routing on the grid; edge labels placed on the longest horizontal run of
  their edge, dropped (with the edge kept) when no run fits.
- **Legibility threshold:** layout refuses graphs past ~20 nodes or when routing would exceed
  the width budget, with a `RangeError` naming the fallbacks (FSL one-liner, adjacency list,
  mermaid emission). The number is a reviewable constant, not folklore.

**`diagrams/renderers.ts`** — the public forms.

- `renderStateDiagram(graph | fslSource, { activeState?, frame?, width? })` — boxes and
  labeled arrows; the active state's box drawn with a doubled label marker (`▶ label`), since
  bolding does not exist inside a code fence.
- `renderDigraph(graph, options)` — same drawing engine, no state-machine affordances;
  the form for dependency graphs, call flows, lineage.
- `renderTree(root, children, options)` — the strict-hierarchy special case; simpler tidy
  layout, used when the input is genuinely a tree (decision trees, file/module trees with
  annotations). Refuses non-tree input by naming the shared node.
- `renderSequence(actors, messages, options)` — lifelines and horizontal arrows, one row per
  message. Singled out because the issue comment identifies sequence-over-time as "the one
  shape that is genuinely painful to hand-draw" — and it is simultaneously the *most*
  mechanical to render programmatically: fixed lifeline columns, monotone rows, no layout
  search at all. The renderer answer dissolves the comment's worry; this form is in v1.

**`diagrams/mermaid.ts`** — the secondary emission.

- `toMermaid(graph, dialect: 'stateDiagram-v2' | 'flowchart')` — a serializer, no layout.
  Emitted only on request, for destinations with renderers.

**`diagrams/index.ts`** — re-exports; `src/ts/index.ts` adds the barrel export so diagrams
are also library API, matching charts.

### MCP surface

One new tool in a new `src/ts/mcp/diagram_tools.ts`, `registerDiagramTools(server, store)`,
called from `buildServer` alongside the existing registrations:

| tool | forms | input | notes |
|---|---|---|---|
| `render_diagram` | `state` · `digraph` · `tree` · `sequence` | structured `edges`/`nodes`, or `fsl: string` for the `state` form | `frame` default true; `width` default 78; `emit: 'ascii' \| 'mermaid' \| 'both'` default `ascii` |

Same conventions as `chart_tools.ts`: `form` as a `tuple()`/`z.enum` so a misspelled form is
unnameable; per-form required fields validated at dispatch with errors naming the full
requirement; renderer `RangeError`s returned as `error: `-prefixed tool text, never a
protocol fault. The refusal path matters more here than in charts: a too-big graph's error
text carries the fallback menu, so the model's next action is named rather than guessed.

&nbsp;

## Alternatives rejected, and why

- **Mermaid as the primitive.** Settled empirically: it does not render in the surface this
  plugin lives in; the reader gets raw source. Kept only as an opt-in export.
- **DOT/Graphviz.** Native binary dependency on three hosts including Windows; unrendered
  source reads worst of all candidates. Not even kept as an export.
- **jssm as a runtime dependency.** Would be the natural choice — it is the owner's own
  renderer for the owner's own language — but the project's zero-dependency constraint
  (`node:sqlite` only) is load-bearing and was preserved even for PNG encoding in issue #7.
  The FSL subset parser costs less than the constraint is worth. Revisit if the rule relaxes.
- **PNG diagrams.** Issue #7's write-then-`Read` pattern works, but a PNG forfeits exactly
  the properties the issue names as the reason text won: transcript-native, greppable,
  diffable, SQLite-loggable. PNG stays the history-review mechanic; diagrams stay text.
- **Emoji-decorated diagrams.** Double-width glyphs cannot sit on a single-width grid; this
  is the documented reason the colored timeline dropped its rail. Color-by-emoji is
  incompatible with alignment, and alignment is the diagram.
- **Freehand drawing by the model (status quo).** Produces the error class this whole
  project exists to prevent: misaligned edges, ragged right margins, arrows that touch the
  wrong box, and no validator. The issue itself is the bug report.
- **Extending `src/ts/charts/` instead of a sibling directory.** Muddles two different
  correctness contracts and the Stryker narrowing; see the comparison table above. The
  separation *is* the issue title.
- **Trailing-whitespace padding as the default rectangle strategy.** Invisible characters
  that editors, linters, hooks, and `.editorconfig` all destroy on contact; a diagram whose
  shape depends on them decays. Framing wins by being made of visible characters.

&nbsp;

## Testing (for the implementation, pinned now as contract)

- **Invariant specs** (unit): output is rectangular when framed; no line exceeds the width
  budget; no trailing whitespace on any line; every node label appears exactly once; every
  edge is traceable through the grid from source box to target box; determinism (two calls,
  identical strings).
- **Golden specs**: a small canon of machines — two-state toggle (`renderFsl`'s own doc
  example), traffic light, a fan-in/fan-out digraph shaped like the tri-host layout, one
  sequence diagram — pinned byte-identical. Goldens are few and structural changes to layout
  are expected to update them consciously; the invariants are the broad net.
- **Stochastic specs** (fast-check, in `*.stoch.ts` per house convention): random DAGs up to
  the legibility threshold — invariants hold; random graphs past the threshold — refusal,
  never a malformed drawing; FSL round-trip property on random edge lists; junction
  resolution closed under drawing order (drawing the same lines in any order yields the same
  grid).
- **Mutation**: extend Stryker's `mutate` to `src/ts/diagrams/fsl.ts`, `grid.ts`, and
  `mermaid.ts` — deterministic string logic, the case mutation testing is for — and
  deliberately exclude `layout.ts`, whose heuristics would generate surviving-mutant noise
  without indicating missing tests. Record the exclusion and its reason in
  `stryker.config.json` comments and `plugin-layout.md`.
- **MCP layer spec**: each form through `buildServer`, including the `fsl` input path, the
  `emit: 'both'` path, and the refusal path's error text.

&nbsp;

## Open questions for review

1. **Arrowheads:** Unicode `▶ ◀ ▲ ▼` (crisper, still single-width, near-universal) vs ASCII
   `> < ^ v` (indestructible). Proposal: Unicode triangles, same conservatism tier as the
   box-drawing set — but this is taste and cheap to flip.
2. **Legibility threshold value:** ~20 nodes is proposed from typical 78-column capacity, not
   measured. Fine to ship as a constant and tune against real use.
3. **Logging:** should rendered diagrams log to SQLite as their own kind, or as ordinary
   rendered blocks? Nothing in this design depends on the answer; deferring to the
   configuration-surface work (#30) seems right.
4. **Before/after architecture diffs:** v1 draws two diagrams side by side or stacked, by
   hand of the caller. A true diff form (shared layout, changed edges marked) is real work
   and is deliberately *not* in the checklist below; it should become its own issue if the
   base mechanic earns it.

&nbsp;

## Post-approval implementation checklist

In dependency order; each item ships with its DocBlocks (summary line, constraints,
realistic `@example` with exact output, `@throws`, `@see`), its unit + stochastic tests, and
README updates where public surface changes.

1. `src/ts/diagrams/model.ts` — types, `normalizeGraph`, input validation.
2. `src/ts/diagrams/grid.ts` — cell buffer, drawing ops, junction resolution, `frame`,
   `render`.
3. `src/ts/diagrams/fsl.ts` — subset parser + round-trip property tests against `renderFsl`.
4. `src/ts/diagrams/layout.ts` — layering, ordering, routing, legibility refusal.
5. `src/ts/diagrams/renderers.ts` — `renderStateDiagram`, `renderDigraph`, `renderTree`,
   `renderSequence`.
6. `src/ts/diagrams/mermaid.ts` — `toMermaid`, both dialects.
7. `src/ts/diagrams/index.ts` + barrel export from `src/ts/index.ts`.
8. `src/ts/mcp/diagram_tools.ts` — `render_diagram`, registered in `buildServer`; MCP layer
   spec.
9. `stryker.config.json` — extend `mutate` per the Testing section; document the `layout.ts`
   exclusion.
10. `src/doc_md/plugin-layout.md` — add `diagrams/` to the tree; move this issue out of the
    charts item's "no diagram language" carve-out.
11. README (via its madlibs source, not the generated file) — Diagrams section: the tool, the
    forms, the when-to-reach-for-it guidance, the mermaid export.
12. Skill text — extend the visuals guidance with the chart/timeline/diagram decision rule
    from this document.
