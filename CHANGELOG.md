# Changelog

All notable changes to this project will be documented in this file.

47 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:10:00 AM

Commit [ba111ff8f161c9f678a3f3ac3f0f0d9bee65ad53](https://github.com/StoneCypher/self-expression/commit/ba111ff8f161c9f678a3f3ac3f0f0d9bee65ad53)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: public aggregation carries structured fields only, never free text (#31)
  * Implements the 2026-08-27 structured-aggregation design spec: a single
enforcement module, src/ts/channels/public_export.ts, whose PUBLIC_TREATMENTS
table classifies every entries column exactly once as verbatim, coarsen, hash,
derive, or excluded. The exporter builds its SELECT from that table — allowlist
by construction, no SELECT * anywhere on the export path — and a totality test
against ENTRIES_DDL fails the build if a future schema column is ever left
unclassified.
  * Treatments follow the spec exactly: closed vocabularies and safe scalars
verbatim (model/host capped at 64 chars); ts_utc truncated to hour or day;
lengths and token counts as pow2 buckets; small counters capped at 33+;
host_version to its major; session/prompt_id/machine_id/agent_id/uuid/
series_key and correction edges HMAC-SHA-256 under a fresh per-submission salt
never persisted (corrects_id exports as the salted hash of the target row's
uuid); local_period and local_dow derived from ts_local with no tz export;
cctype validated against the closed conventional-commit list and face as
exactly one emoji grapheme, else NULL; text, title, cwd, project, git_branch,
tz, agent_type, context_emoji, permission_mode, turn_index, and all raw
identifiers excluded.
  * The share MCP tool (preview / export / status) wraps the module: preview
renders the exporter's actual return value, so it cannot drift, and export
refuses until a preview for the same options was rendered this session. Opt-in
is default-off, exact-affirmative, and event-based via the #30 config registry
(share.enabled, share.opted_in_utc, share.time_granularity): setting
share.enabled true stamps the opt-in moment, opting out clears it, and only
rows at or after the most recent moment are ever eligible — never retroactive.
  * Tests cover the normative plan: DDL totality, the sentinel-prose stochastic
suite (a marker planted in every open-string field never survives export,
through the exporter and both tool verbs), linkage (fresh salts share nothing,
equal inputs group within one export), coarsening properties, validator
fuzzing, the opt-in gate, and preview identity. README and plugin-layout
document the boundary and the honest claim: no free text, reduced linkage,
coarsened time — nothing stronger.
  * Closes #31




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:07:33 AM

Commit [f881ea60dffef3d3b861898aeb8cb9d71a4d41d9](https://github.com/StoneCypher/self-expression/commit/f881ea60dffef3d3b861898aeb8cb9d71a4d41d9)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 6e33f56ce749526a97daadda6a9c080f89ee9418




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:06:29 AM

Commit [6e33f56ce749526a97daadda6a9c080f89ee9418](https://github.com/StoneCypher/self-expression/commit/6e33f56ce749526a97daadda6a9c080f89ee9418)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [9ae1f2c, ef56598]

  * Merge pull request #67 from StoneCypher/feat_26-08-28_dwelling_45
  * feat: the dwelling — a per-assistant keepsake database behind a single dwell tool




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:05:35 AM

Commit [3b098ad0856b404a564721616b1a7a06556f12b4](https://github.com/StoneCypher/self-expression/commit/3b098ad0856b404a564721616b1a7a06556f12b4)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [0c06b73, 9ae1f2c]

  * chore: merge origin/main (#7 png history) and rebuild
  * Generated artifacts (README, CHANGELOG, coverage, dist, docs) taken from the
rebuild; the entries test imports union the #7 history helpers with the #42
forecastOutcomes helper. Full build green after merge.
  * Refs #42




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:05:01 AM

Commit [ef56598203ecce04a4a121786b17abdbccffffe6](https://github.com/StoneCypher/self-expression/commit/ef56598203ecce04a4a121786b17abdbccffffe6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate artifacts after the png-history merge; widen stochastic test timeouts
  * The dwelling stochastic properties run against real SQLite files and share the
machine with sibling builds; the 5 s default timeout measured the machine, not
the invariant. Explicit 60 s timeouts and slightly fewer runs keep the
properties intact.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:04:46 AM

Commit [1ac1ea071d07b45ae312d44467b2d24869de554f](https://github.com/StoneCypher/self-expression/commit/1ac1ea071d07b45ae312d44467b2d24869de554f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: diagrams as a distinct mechanic from charts
  * Adds src/ts/diagrams/ — a sibling of charts with its own correctness
contract (invariants plus a small golden canon, not byte-exact strings):
  * - model.ts: Digraph model, normalizeGraph, grid-safety guard rejecting
  double-width glyphs, combining marks, and newlines by name
- grid.ts: character grid with box-drawing junction resolution (arm-mask
  OR), framed-by-default rendering, no trailing whitespace ever
- fsl.ts: FSL-subset parser, round-trip compatible with renderFsl;
  everything outside the subset is a RangeError naming the subset
- layout.ts: longest-path layering with DFS-marked back edges,
  barycenter ordering, orthogonal routing; refusals name the fallback
  menu (FSL one-liner, adjacency list, mermaid export); the legibility
  threshold ships as the reviewable constant MAX_DIAGRAM_NODES = 20
- renderers.ts: renderStateDiagram (Digraph or FSL source, active state
  marked with a doubled label marker), renderDigraph, renderTree,
  renderSequence
- mermaid.ts: toMermaid (stateDiagram-v2 | flowchart), opt-in export only
  * MCP: one grouped render_diagram tool (state | digraph | tree | sequence)
in src/ts/mcp/diagram_tools.ts, registered in buildServer; form is a
closed z.enum; per-form requirements checked at dispatch; renderer
RangeErrors returned as error: text, never a protocol fault.
  * Tests: invariant + golden unit specs, fast-check stochastic suites
(junction-order closure, FSL round trip, random graphs render
well-formed or refuse by name), MCP layer specs. Stryker mutate extended
to diagrams' deterministic string files; layout.ts/renderers.ts excluded
with the reason recorded in mutate_comment and plugin-layout.md.
  * Docs: README Diagrams section (via base_README.md), plugin-layout.md
tree and carve-out updates, visuals.md chart/timeline/diagram decision
rule; package.json dts step copies dist/diagrams declarations.
  * Closes #19




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:01:21 AM

Commit [0c06b73880256aef3e5c361a25f93858d33c615c](https://github.com/StoneCypher/self-expression/commit/0c06b73880256aef3e5c361a25f93858d33c615c)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [e8baf0b, 32c17a7]

  * chore: merge origin/main (#30 config surface) and integrate
  * Integrates the channel extensions with the #30 config registry:
  * - forecast.enabled, salience.enabled, revision.enabled, gifts.enabled, and
  roster.enabled register in CONFIG_KEYS with the spec defaults, so configure
  set validates and canonicalizes them and configure list reports them.
- enabledConfidenceGrounds and conventionFlags read through the tolerant
  effective-value accessor (D5): an invalid stored override behaves as unset.
- handleExpress keeps #30's ToolReply shape and format-version stamping, and
  gains the #42 outcome-target check and the resolveBy/outcome/silence
  arguments; the confidence enum narrows via enabledConfidenceGrounds.
- time.hook (D9) composes with the conventions flags: suppressing the clock
  keeps the flags segment leading the clockless line, since the flags are
  config transport, not time presentation.
- Generated artifacts (README, CHANGELOG, coverage, dist, docs) rebuilt.
  * Refs #42




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:01:00 AM

Commit [44b05f097361b2a5b85ede8216dbeb9d911133fa](https://github.com/StoneCypher/self-expression/commit/44b05f097361b2a5b85ede8216dbeb9d911133fa)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [6fa2263, 9ae1f2c]

  * chore: merge origin/main (#7 png history); rebuild follows




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:59:40 AM

Commit [b15114e3409c8d549723e02557fa43c007bd140c](https://github.com/StoneCypher/self-expression/commit/b15114e3409c8d549723e02557fa43c007bd140c)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 9ae1f2ce1feeca4913fe88a829faabaa4f271580




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:58:52 AM

Commit [6fa22633d365b1ab9ad94ffaa1b7ccfe150cdc8e](https://github.com/StoneCypher/self-expression/commit/6fa22633d365b1ab9ad94ffaa1b7ccfe150cdc8e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate artifacts after the config-surface merge