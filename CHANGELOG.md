# Changelog

All notable changes to this project will be documented in this file.

40 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





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




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 11:54:50 PM

Commit [872f24d858374a2c2680a06d8504b3147bc5eea7](https://github.com/StoneCypher/self-expression/commit/872f24d858374a2c2680a06d8504b3147bc5eea7)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [733744b, 0f6f14c]

  * Merge pull request #54 from StoneCypher/fix_26-08-27_stable-checklist-series-key_27
  * fix: checklist series key is a stable id, not the title




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 11:53:48 PM

Commit [0f6f14cc90707a39fff993b8e3ca5639a36c7c97](https://github.com/StoneCypher/self-expression/commit/0f6f14cc90707a39fff993b8e3ca5639a36c7c97)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [13c25cc, 733744b]

  * chore: merge origin/main and rebuild artifacts
  * Resolved conflicts (all in generated artifacts: CHANGELOGs, README,
coverage-stoch, doc_md changelogs) by taking main's side, then
regenerated everything with a full build over the merged source.
444 unit + 43 stochastic tests pass.