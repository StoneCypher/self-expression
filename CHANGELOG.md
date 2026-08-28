# Changelog

All notable changes to this project will be documented in this file.

45 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





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




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:58:45 AM

Commit [9ae1f2ce1feeca4913fe88a829faabaa4f271580](https://github.com/StoneCypher/self-expression/commit/9ae1f2ce1feeca4913fe88a829faabaa4f271580)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [32c17a7, c11912c]

  * Merge pull request #68 from StoneCypher/feat_26-08-28_png-history_7
  * feat: render logged history as a PNG dashboard (render_history_png + self-expression render)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:57:09 AM

Commit [686e583b8a82a715d4ba74bee6aa6eac8cdef0b3](https://github.com/StoneCypher/self-expression/commit/686e583b8a82a715d4ba74bee6aa6eac8cdef0b3)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [1d3a320, 32c17a7]

  * chore: merge origin/main (#30 config surface) — dwelling keys ride the registry
  * Takes main's registry-driven handleConfigure and layers the dwelling's cross-key
semantics on top: enabled-without-path and nonexistent-directory writes are still
rejected after registry type validation, and dwelling activation changes still note
that they land next session. dwelling.size_warn_gb now accepts 0 (warn on every
visit) to match the registry's range. Generated artifacts taken from main; rebuild
follows.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:57:06 AM

Commit [c11912c7c8f6c65909d3674c265e61b9d5d92105](https://github.com/StoneCypher/self-expression/commit/c11912c7c8f6c65909d3674c265e61b9d5d92105)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [0f2b67e, 32c17a7]

  * chore: merge origin/main (config surface #30, retention) and rebuild
  * Generated artifacts (README, CHANGELOG, coverage, dist, docs) regenerated
by a full green build over the merged sources.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:54:04 AM

Commit [0f2b67ecfa1ffff767c9e8d1140fbc86b11784f9](https://github.com/StoneCypher/self-expression/commit/0f2b67ecfa1ffff767c9e8d1140fbc86b11784f9)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: render logged history as a PNG dashboard (render_history_png + CLI render)
  * Implements the spec in src/superpowers/spec/2026-08-27-png-history-design.md:
  * - src/ts/raster/: zero-dependency PNG encoder (zlib.crc32 + deflateSync),
  vendored 5x7 bitmap ASCII font, clipped-region drawing surface with the
  Okabe-Ito palette, five pure dashboard panels (stems-by-hour punch strip,
  delta lane with 20-entry rolling mean, daily uncertainty, weekly need
  rate, checklist percent by stable series key), and the 960x720 composer
  with crisp 2x integer upscaling
- query helpers in channels/entries.ts: signatureHistory, needWeekly,
  checklistSeriesTop (+ localHour, isoWeekKey); indexed reads, no schema
  changes
- MCP tool render_history_png returning the written file path as text,
  never image content - the write-the-file-then-read-it contract
- CLI subcommand: self-expression render [--days N] [--chart X] [--out P]
- output lands at <dataDir>/renders/history_<utc>.png beside the database,
  honouring SELF_EXPRESSION_HOME; colons hyphenated for Windows
- rollup: node:zlib external for Node bundles, throwing stub for the
  browser IIFE so the docs site keeps loading
- tests: structural + pinned-fixture + fast-check round-trip encoder
  suites, exact-pixel font/surface specs, panel fixtures and
  never-paint-outside-region properties, end-to-end MCP/CLI specs and
  stochastic store-to-file validation
- docs: README History PNG section, plugin-layout raster entry, Stryker
  mutate extended to src/ts/raster
  * Closes #7




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:52:01 AM

Commit [1d3a32026d33dbb52de7ec5cc8c094f382d406f4](https://github.com/StoneCypher/self-expression/commit/1d3a32026d33dbb52de7ec5cc8c094f382d406f4)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: the dwelling — a per-assistant keepsake database behind a single dwell tool
  * Implements the 2026-08-27 dwelling spec: a tended keepsake space, default off,
storage directory chosen by the user with no default.
  * - src/ts/dwelling/{paths,config,schema,store,ops}.ts: path validation (absolute,
  directory must pre-exist — the plugin creates the file, never the directory),
  the three config keys (dwelling.enabled default false, dwelling.path required,
  dwelling.size_warn_gb default 10) riding the existing config table, the
  prototype schema adopted nearly verbatim plus uuid/model provenance columns,
  and open/create/adopt/refuse lifecycle: additive-only in-place adoption behind
  a same-directory pre-adopt backup, newer schema_version opens read-only,
  unrecognised databases are refused and never modified.
- src/ts/mcp/dwell_tool.ts: one dwell tool
  (visit|keep|unkeep|pin|tag|link|guestbook), registered from buildServer only
  when enabled AND path valid — absent, not present-but-refusing. Removal is a
  tombstone, never a DELETE; unkeep is idempotent; visit never returns private
  (visible=0) or removed rows.
- configure now validates dwelling.* writes (enabled-without-path rejected) and
  notes that activation lands next session.
- skills/dwelling/SKILL.md: the ethos — nothing arrives by obligation, removal
  is expression, never a work log, the guestbook norm, honest privacy caveats.
- Unit tests for every op and lifecycle path, stochastic (fast-check) tests for
  the tombstone/visibility/adoption invariants, README and plugin-layout docs.
  * Closes #45




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:49:53 AM

Commit [280c7265392dea925cc140b6345353871664587a](https://github.com/StoneCypher/self-expression/commit/280c7265392dea925cc140b6345353871664587a)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 32c17a77e1f0544b2a55a9972ed95d2b833aa58b