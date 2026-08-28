# Changelog

All notable changes to this project will be documented in this file.

40 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





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




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:48:49 AM

Commit [e8baf0bf9eec24e701743e87e1a19ec91654c9de](https://github.com/StoneCypher/self-expression/commit/e8baf0bf9eec24e701743e87e1a19ec91654c9de)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: channel extensions — forecast ground, faded kind, salience flag transport, typed silence, load and taste channels, v1→v2 migration
  * Implements all six extensions from the 2026-08-27 channel-extensions design
spec (src/superpowers/spec/2026-08-27-channel-extensions-design.md):
  * 1. Forecast ground 'predicted' joins CONFIDENCE_GROUNDS, with nullable
   resolve_by (ISO local date) and outcome (hit/miss/void) columns.
   Resolution rides the existing corrects_id chain; the tool layer rejects
   an outcome whose target is not a predicted row, naming its actual
   ground. forecast.enabled (default on) is enforced by baking the grounds
   enum at server startup via enabledConfidenceGrounds(store).
   forecastOutcomes(store) returns the calibration series (voids excluded
   from hit rate by documented rule).
2. Divergence kind 'faded' joins DIVERGENCE_KINDS, documented as
   normatively never an error.
3. Salience ⭑ lands as a skill convention with salience.enabled carried to
   static skills via the new conventions-flags segment on the hook context
   line (conventionFlags/CONVENTION_FLAGS) — the general transport for
   skill-level toggles (salience/revision/gifts/roster), coordinating with
   the #30 config surface.
4. Typed silence: closed SILENCE_KINDS vocabulary (empty/unlooked/held/
   depth) as a nullable qualifier column on any channel.
5. Self-state decoration glyph table (derived, never stored) folded into
   the skill, plus the new 'load' channel (proprioception).
6. The 'taste' channel (#-line, 🎨, scarce), toggled by channels.enabled.
  * Cross-cutting: SCHEMA_VERSION bumps to 2 with reusable versioned-migration
machinery (src/ts/channels/migrate.ts) — stepwise MigrationStep chain; the
v1→v2 step is a transactional table rebuild (explicit column lists both
sides, ids preserved, indices recreated, FK enforcement suspended around
the rebuild per the standard SQLite recipe). openStore now reads the
stored schema_version BEFORE stamping it — fixing the latent bug that
would have marked a v1 database current without migrating — migrates when
behind, and refuses newer-than-code or non-integer stored versions.
  * Field-trial adoptions: status markers 🔬 (under review) and 🔁 (fix round)
join markers.md and CANONICAL_ORDER with pinned ranks; activity-glyph
examples 🗃️ 🌐 🧹 join the vendored visuals doc.
  * Tests: vocabulary pins, schema CHECK coverage, cross-field validation
matrix, forecastOutcomes, tool-layer resolution checks, conventions-flags
rendering, migration fixture round-trip on a literal v1 DDL, and two new
stochastic suites — any-v1-database lossless migration, and
validator-vs-CHECK agreement across every constrained column.
  * Closes #42




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:48:46 AM

Commit [32c17a77e1f0544b2a55a9972ed95d2b833aa58b](https://github.com/StoneCypher/self-expression/commit/32c17a77e1f0544b2a55a9972ed95d2b833aa58b)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [4b4cf6f, 22e8cd8]

  * Merge pull request #65 from StoneCypher/feat_26-08-28_config-surface_30
  * feat: configuration surface — key registry, validated configure ops, retention, format stamping (#30)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:46:29 AM

Commit [22e8cd82ae835c8ff55c2c1785335e6b96d0fdc6](https://github.com/StoneCypher/self-expression/commit/22e8cd82ae835c8ff55c2c1785335e6b96d0fdc6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: config surface — key registry, validated configure ops, retention, format stamping
  * Implements the nine decisions of src/superpowers/spec/2026-08-27-config-surface-design.md (issue #30):
  * - D1: declarative CONFIG_KEYS registry in src/ts/channels/config.ts — name, kind, code default, description, canonicalizing validator per key; the eight #30 keys plus the three dwelling.* keys from the #45 spec, so adding a key is one entry
- D2: configure set validates known keys and stores canonical text (bool lowercased; int decimal in range; channel list trimmed/joined; string trimmed, capped); invalid values name what would have been accepted and write nothing
- D3: unknown keys are stored with a stated warning, never rejected and never silent
- D4: new unset op (delete the override; code default applies again) and list now reports effective configuration — every registry key with value and source, unknown rows labeled
- D5: tolerant effectiveValue accessor — an invalid stored row behaves as unset; readers never throw
- D6: retention.days prunes entries and turn_context at server startup (channels/retention.ts, called fail-open from startStdio); 0 never prunes; meta and config untouched
- D7: FORMAT_VERSION constant; express (and log_checklist) stamp every row with the configured override, else the constant — fixing the always-NULL format_version
- D8: gate.checklist registered and validated now, consumed when the checklist gate lands
- D9: time.hook exactly 'false' suppresses only the clock sentence; context recording is unchanged and the open reminder goes out in clockless wording
  * deleteConfig added to store.ts; express/configure handler bodies extracted as testable functions; unit + stochastic (fast-check) tests; README configuration section and plugin-layout decision entry.
  * Closes #30




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:18:06 AM

Commit [0e228680b7fd8392611b5548d04b5f2ad980e3a6](https://github.com/StoneCypher/self-expression/commit/0e228680b7fd8392611b5548d04b5f2ad980e3a6)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 4b4cf6f9bc947161038285672050b49af98d69a5




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 7:17:06 AM

Commit [4b4cf6f9bc947161038285672050b49af98d69a5](https://github.com/StoneCypher/self-expression/commit/4b4cf6f9bc947161038285672050b49af98d69a5)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [afccb20, 6bff4f0]

  * Merge pull request #46 from StoneCypher/dependabot/npm_and_yarn/minor-and-patch-c82767db01
  * chore(deps-dev): bump the minor-and-patch group with 3 updates




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:02:49 AM

Commit [afccb206d1dc3397c4452452419fc61e6f281d32](https://github.com/StoneCypher/self-expression/commit/afccb206d1dc3397c4452452419fc61e6f281d32)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [872f24d, 941fff4]

  * Merge pull request #55 from StoneCypher/feat_26-08-27_mcp-ify-loggers_10
  * feat(mcp): port the checklist logger and validator to MCP tools — the remaining half of #10




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:01:38 AM

Commit [941fff48a34d1b428764cecde3893ea2e1ae46e9](https://github.com/StoneCypher/self-expression/commit/941fff48a34d1b428764cecde3893ea2e1ae46e9)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [960abf0, 872f24d]

  * chore: merge origin/main (#54 stable seriesKey contract) and rebuild
  * Integrates the checklist MCP tools onto #54's now-merged semantics:
log_checklist's seriesKey becomes required and explicit — never defaulted
from the display title, which #54's contract names as the fragility being
removed (#27). Tests updated to match; blank-seriesKey rejection pinned.
Generated artifacts (README, CHANGELOG*, coverage-stoch) regenerated by
the build: 484 unit + 46 stochastic tests passing.