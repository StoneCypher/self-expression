# Changelog

All notable changes to this project will be documented in this file.

56 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:28:10 AM

Commit [5b357c4204cd3d058a481e9789e0bc9dbe977c76](https://github.com/StoneCypher/self-expression/commit/5b357c4204cd3d058a481e9789e0bc9dbe977c76)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [f0d20db, 52dc11c]

  * Merge remote-tracking branch 'origin/main' into feat_26-08-28_compression_20
  * # Conflicts:
#       CHANGELOG.long.md
#       CHANGELOG.md
#       README.md
#       coverage-stoch/coverage-final.json
#       coverage-stoch/index.html
#       coverage-stoch/ts/channels/config.ts.html
#       coverage-stoch/ts/channels/context.ts.html
#       coverage-stoch/ts/channels/entries.ts.html
#       coverage-stoch/ts/channels/index.html
#       coverage-stoch/ts/channels/paths.ts.html
#       coverage-stoch/ts/channels/privacy.ts.html
#       coverage-stoch/ts/channels/retention.ts.html
#       coverage-stoch/ts/channels/schema.ts.html
#       coverage-stoch/ts/channels/store.ts.html
#       coverage-stoch/ts/channels/time.ts.html
#       coverage-stoch/ts/channels/vocabulary.ts.html
#       coverage-stoch/ts/charts/bars.ts.html
#       coverage-stoch/ts/charts/checklist.ts.html
#       coverage-stoch/ts/charts/glyphs.ts.html
#       coverage-stoch/ts/charts/index.html
#       coverage-stoch/ts/charts/index.ts.html
#       coverage-stoch/ts/charts/markers.ts.html
#       coverage-stoch/ts/charts/rows.ts.html
#       coverage-stoch/ts/charts/scale.ts.html
#       coverage-stoch/ts/charts/series.ts.html
#       coverage-stoch/ts/charts/timeline.ts.html
#       coverage-stoch/ts/charts/verify.ts.html
#       coverage-stoch/ts/cli.ts.html
#       coverage-stoch/ts/cli_commands.ts.html
#       coverage-stoch/ts/index.html
#       coverage-stoch/ts/index.ts.html
#       coverage-stoch/ts/mcp/chart_tools.ts.html
#       coverage-stoch/ts/mcp/checklist_tools.ts.html
#       coverage-stoch/ts/mcp/hooks.ts.html
#       coverage-stoch/ts/mcp/index.html
#       coverage-stoch/ts/mcp/server.ts.html
#       coverage-stoch/ts/mcp/tools.ts.html
#       coverage-stoch/ts/raster/compose.ts.html
#       coverage-stoch/ts/raster/encoder.ts.html
#       coverage-stoch/ts/raster/font.ts.html
#       coverage-stoch/ts/raster/index.html
#       coverage-stoch/ts/raster/index.ts.html
#       coverage-stoch/ts/raster/panels.ts.html
#       coverage-stoch/ts/raster/surface.ts.html
#       coverage-stoch/ts/stub.ts.html
#       coverage-typedoc/coverage-typedoc.json
#       dist/index.cjs
#       dist/index.cjs.map
#       dist/index.d.cts
#       dist/index.iife.js
#       dist/index.iife.js.map
#       dist/index.mjs
#       dist/index.mjs.map
#       src/doc_md/CHANGELOG.long.md
#       src/doc_md/CHANGELOG.md




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:26:30 AM

Commit [0b43f5d93b9d68df313063fab394568dd5d6d514](https://github.com/StoneCypher/self-expression/commit/0b43f5d93b9d68df313063fab394568dd5d6d514)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 52dc11c05b0f94f58c056c6bda336fd9d2ed85b2




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:26:22 AM

Commit [f0d20db767648f2876aaadd721c7966f66850547](https://github.com/StoneCypher/self-expression/commit/f0d20db767648f2876aaadd721c7966f66850547)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: treat compression as the mechanic, not lists — digest core, profiles, render_digest, verifyDigest
  * Full build green (exit 0): tsc, eslint, unit (745), stochastic (78 incl.
the new six-invariant properties and the 500-run byte-identity oracle),
typedoc, rollup, attw all pass. Regenerated artifacts (dist, README,
changelogs, coverage) restored by the green build are included here.
  * Implements src/superpowers/spec/2026-08-27-compression-mechanic-design.md:
  * - charts/digest.ts: profile-independent renderDigest extracted from
  checklist.ts, plus leadUnitIndex (lead-line argmax), overallBucket,
  and nestDigest (nesting by digest substitution)
- charts/profiles.ts: checklist/findings/options/diff/results as data
- charts/checklist.ts: now the checklist-profile instantiation,
  byte-identical output, existing suites unmodified as the gate
- charts/verify.ts: verifyDigest generalizes the validator (noun-inferred
  profile, checklist delegation, shared icon-section checks)
- mcp/chart_tools.ts: render_digest tool beside render_checklist_summary
- docs: markers.md profile bucket membership, skill summary-line pointer,
  base_README Charts/Checklists sections
  * Refs #20




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:25:10 AM

Commit [9c218dcf7f97ce4eaed8c803cff2a573aeec11e2](https://github.com/StoneCypher/self-expression/commit/9c218dcf7f97ce4eaed8c803cff2a573aeec11e2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: checkpoint before token exhaustion
  * Addressivity (#41) mid-implementation. Build NOT yet run — source
compiles unverified, tests not yet written. See PR body for the
full handoff: what is done, what remains, exact next steps.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:25:09 AM

Commit [601b81fc0f4a04f29400afe6cec2e5b60cf64843](https://github.com/StoneCypher/self-expression/commit/601b81fc0f4a04f29400afe6cec2e5b60cf64843)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: checkpoint before token exhaustion
  * Claudio facility (#44) core in place: vocabulary, wav, synth, config,
schema, ledger, gate, player, tools, server, cli entry, registry keys,
build wiring, vendored assets. tsc compiles clean; unit/stoch tests
partially written (wav+synth specs done); full build NOT yet run.
  * Refs #44




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:25:09 AM

Commit [52dc11c05b0f94f58c056c6bda336fd9d2ed85b2](https://github.com/StoneCypher/self-expression/commit/52dc11c05b0f94f58c056c6bda336fd9d2ed85b2)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [560ac8c, 60c2f90]

  * Merge pull request #69 from StoneCypher/feat_26-08-28_diagrams_19
  * feat: diagrams as a distinct mechanic from charts (#19)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:25:01 AM

Commit [e48135372643e10f96debad804157904a83705f3](https://github.com/StoneCypher/self-expression/commit/e48135372643e10f96debad804157904a83705f3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: checkpoint before token exhaustion — compression mechanic (#20) implemented, final full-build rerun pending
  * Implements the compression-mechanic spec: charts/digest.ts core extracted
from checklist.ts (byte-identical checklist output), charts/profiles.ts
profile data (checklist/findings/options/diff/results), render_digest MCP
tool, generalized verifyDigest validator, lead-line argmax + overallBucket
+ nestDigest composition helpers, six invariants as fast-check properties,
docs (markers.md profile buckets, skill pointer, base_README).
  * Build-verification state, honestly: tsc clean; eslint clean; all targeted
spec suites green (116 tests) incl. unmodified checklist gate; stochastic
suites green (19 props incl. byte-identity oracle, 500 runs); first full
build failed ONLY on pre-existing src/ts/tests/config.stoch.ts 5s timeout
(unrelated, passes standalone in 4.2s); full-build rerun was in progress
at checkpoint time.
  * Refs #20




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:24:44 AM

Commit [676e7ad8596d436935d4c4d430e7746933f8f1d4](https://github.com/StoneCypher/self-expression/commit/676e7ad8596d436935d4c4d430e7746933f8f1d4)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: checkpoint before token exhaustion — regenerated artifacts after the #42 merge rebuild
  * Build-verification state, honestly: the full build completed green (exit 0)
immediately before this commit — 910 unit and 83 stochastic tests passing,
eslint clean, attw clean — on top of the second origin/main merge (#42 channel
extensions, schema v2). This commit is that rebuild's regenerated artifacts
(dist, coverage, CHANGELOGs, README) plus nothing else; all source work was
already committed in 956114f and earlier.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:23:30 AM

Commit [60c2f907bdf463aeb46dd4f25ac318c867e7022f](https://github.com/StoneCypher/self-expression/commit/60c2f907bdf463aeb46dd4f25ac318c867e7022f)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [6bfe771, 560ac8c]

  * chore: merge origin/main (channel extensions #42) and rebuild
  * Integrations:
- src/doc_md/plugin-layout.md: tree keeps the migrations note beside the
  charts/diagrams contract split
- src/ts/tests/config.stoch.ts: took main's convergent 30s widening of
  the ints property and extended the identical widening to the other
  three store-backed properties, which flaked the same way under
  concurrent sibling builds
  * Generated artifacts regenerated by the full build on the merged tree.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 8:22:29 AM

Commit [956114ffee795694f7efedcf7f02dcf3823ae8a8](https://github.com/StoneCypher/self-expression/commit/956114ffee795694f7efedcf7f02dcf3823ae8a8)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [056a094, 560ac8c]

  * chore: merge origin/main (#42 channel extensions); classify the three v2 columns
  * Schema v2's totality drift is exactly what the #31 allowlist exists to catch:
outcome and silence are CHECK-backed closed vocabularies and classify verbatim
per the spec's stated rule; resolve_by is write-validated to a local date but
carries no CHECK, so it stays excluded — conservative until a reviewer promotes
it to an export-validated date. config.spec/config.stoch hand-merged (the #42
convention keys alongside the #31 share keys; the wider of the two timeout
choices kept). Generated artifacts taken from main pending the rebuild.