# Changelog

All notable changes to this project will be documented in this file.

67 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:31:46 PM

Commit [e0d80d2ae17cf50e42ae6f47c02b04e1f3f1af8a](https://github.com/StoneCypher/self-expression/commit/e0d80d2ae17cf50e42ae6f47c02b04e1f3f1af8a)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [b7da1ac, 28b41be]

  * Merge remote-tracking branch 'origin/main' into feat_26-08-28_channel-text-lengths_76
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
#       coverage-stoch/ts/channels/messages.ts.html
#       coverage-stoch/ts/channels/migrate.ts.html
#       coverage-stoch/ts/channels/paths.ts.html
#       coverage-stoch/ts/channels/privacy.ts.html
#       coverage-stoch/ts/channels/public_export.ts.html
#       coverage-stoch/ts/channels/retention.ts.html
#       coverage-stoch/ts/channels/schema.ts.html
#       coverage-stoch/ts/channels/store.ts.html
#       coverage-stoch/ts/channels/time.ts.html
#       coverage-stoch/ts/channels/vocabulary.ts.html
#       coverage-stoch/ts/charts/bars.ts.html
#       coverage-stoch/ts/charts/checklist.ts.html
#       coverage-stoch/ts/charts/digest.ts.html
#       coverage-stoch/ts/charts/glyphs.ts.html
#       coverage-stoch/ts/charts/index.html
#       coverage-stoch/ts/charts/index.ts.html
#       coverage-stoch/ts/charts/markers.ts.html
#       coverage-stoch/ts/charts/profiles.ts.html
#       coverage-stoch/ts/charts/rows.ts.html
#       coverage-stoch/ts/charts/scale.ts.html
#       coverage-stoch/ts/charts/series.ts.html
#       coverage-stoch/ts/charts/timeline.ts.html
#       coverage-stoch/ts/charts/verify.ts.html
#       coverage-stoch/ts/claudio/config.ts.html
#       coverage-stoch/ts/claudio/gate.ts.html
#       coverage-stoch/ts/claudio/index.html
#       coverage-stoch/ts/claudio/ledger.ts.html
#       coverage-stoch/ts/claudio/paths.ts.html
#       coverage-stoch/ts/claudio/player.ts.html
#       coverage-stoch/ts/claudio/schema.ts.html
#       coverage-stoch/ts/claudio/server.ts.html
#       coverage-stoch/ts/claudio/synth.ts.html
#       coverage-stoch/ts/claudio/tools.ts.html
#       coverage-stoch/ts/claudio/vocabulary.ts.html
#       coverage-stoch/ts/claudio/wav.ts.html
#       coverage-stoch/ts/claudio_cli.ts.html
#       coverage-stoch/ts/cli.ts.html
#       coverage-stoch/ts/cli_commands.ts.html
#       coverage-stoch/ts/diagrams/fsl.ts.html
#       coverage-stoch/ts/diagrams/grid.ts.html
#       coverage-stoch/ts/diagrams/index.html
#       coverage-stoch/ts/diagrams/index.ts.html
#       coverage-stoch/ts/diagrams/layout.ts.html
#       coverage-stoch/ts/diagrams/mermaid.ts.html
#       coverage-stoch/ts/diagrams/model.ts.html
#       coverage-stoch/ts/diagrams/renderers.ts.html
#       coverage-stoch/ts/dwelling/config.ts.html
#       coverage-stoch/ts/dwelling/index.html
#       coverage-stoch/ts/dwelling/ops.ts.html
#       coverage-stoch/ts/dwelling/paths.ts.html
#       coverage-stoch/ts/dwelling/schema.ts.html
#       coverage-stoch/ts/dwelling/store.ts.html
#       coverage-stoch/ts/index.html
#       coverage-stoch/ts/index.ts.html
#       coverage-stoch/ts/mcp/chart_tools.ts.html
#       coverage-stoch/ts/mcp/checklist_tools.ts.html
#       coverage-stoch/ts/mcp/diagram_tools.ts.html
#       coverage-stoch/ts/mcp/dwell_tool.ts.html
#       coverage-stoch/ts/mcp/hooks.ts.html
#       coverage-stoch/ts/mcp/index.html
#       coverage-stoch/ts/mcp/message_tools.ts.html
#       coverage-stoch/ts/mcp/server.ts.html
#       coverage-stoch/ts/mcp/share_tools.ts.html
#       coverage-stoch/ts/mcp/tools.ts.html
#       coverage-stoch/ts/raster/compose.ts.html
#       coverage-stoch/ts/raster/encoder.ts.html
#       coverage-stoch/ts/raster/font.ts.html
#       coverage-stoch/ts/raster/index.html
#       coverage-stoch/ts/raster/index.ts.html
#       coverage-stoch/ts/raster/panels.ts.html
#       coverage-stoch/ts/raster/surface.ts.html
#       coverage-stoch/ts/stub.ts.html
#       coverage-stoch/ts/tests/helpers/index.html
#       coverage-stoch/ts/tests/helpers/v1_fixture.ts.html
#       coverage-stoch/ts/tests/helpers/v2_fixture.ts.html
#       src/doc_md/CHANGELOG.long.md
#       src/doc_md/CHANGELOG.md
#       src/ts/channels/config.ts
#       src/ts/mcp/tools.ts
#       src/ts/tests/config.spec.ts




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:28:59 PM

Commit [b7da1acc965e111c107d83475390ada546de3222](https://github.com/StoneCypher/self-expression/commit/b7da1acc965e111c107d83475390ada546de3222)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: per-channel text length, user-configurable, defaults raised to 200
  * Text length was governed in two disconnected places, neither the user's to
set: a flat .max(280) on express's text covering all twelve channels, and a
"<=70 characters" instruction in SKILL.md covering one. The enforced number
and the taught number disagreed by a factor of four. This replaces both.
  * - twelve channels.<name>.max_chars keys, generated from CHANNELS so a channel
  added later arrives with its limit registered rather than silently unbounded;
  ordinary CONFIG_KEYS entries, so set/unset/get/list need no special-casing
- defaults of 200 everywhere, replacing both the 280 and the 70
- a hard ceiling of 2000 left in the static zod schema (matching
  MESSAGE_TEXT_MAX, so express and post_message agree), with the real
  per-channel check in handleExpress; the rejection names the channel, the
  configured limit, the length received, and the key that changes it
- minimum of 1, not 0: a zero limit would disable a channel through the wrong
  door, and channels.enabled is that door
- channelLengths renders a `lengths:` segment on the UserPromptSubmit context
  line beside #42's `conventions:` flags -- the same transport, not a second
  one -- against a shared base so the common turn costs `lengths: 200 all`
- the skill now carries two numbers: <=70 stays the stated recommendation with
  its reason intact, and the configured ceiling is granted on top of it as
  headroom for the line that earns it, never as an allowance to spend
  * Open questions settled: enforce (reject, consistent with every other
vocabulary here, and truncation would be a lie about what was said); twelve
flat keys rather than a map (inspectable in `configure list`, no bespoke
grammar); write-only retroactivity, stated normatively in channelMaxChars'
DocBlock -- an over-long stored row is never truncated, hidden, excluded, or
pruned, and deletion belongs to retention.days and to age alone.
  * Closes #76




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:21:17 PM

Commit [0ca51840822be11ac662093cd795133dcd6fd124](https://github.com/StoneCypher/self-expression/commit/0ca51840822be11ac662093cd795133dcd6fd124)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: per-channel text length keys, handler check, hook transport, skill wording




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:21:00 PM

Commit [5bd164c9de2ffa0b900a5be93121ea0eff01c582](https://github.com/StoneCypher/self-expression/commit/5bd164c9de2ffa0b900a5be93121ea0eff01c582)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 28b41beeb9d286b682743b88b3ffccd27378550f




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:19:38 PM

Commit [28b41beeb9d286b682743b88b3ffccd27378550f](https://github.com/StoneCypher/self-expression/commit/28b41beeb9d286b682743b88b3ffccd27378550f)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [8964990, 56ef191]

  * Merge pull request #74 from StoneCypher/feat_26-08-28_onboarding_40
  * feat: first-run onboarding questionnaire — registry, ledger, onboard MCP tool (#40)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:19:28 PM

Commit [5622fef56c1aac7d1852ccfceed0199606d50eee](https://github.com/StoneCypher/self-expression/commit/5622fef56c1aac7d1852ccfceed0199606d50eee)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: anchoring core — vocabulary, anchors module, schema v4, entries, renderer, tools




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:16:39 PM

Commit [56ef1919339382232049109bce14452fef649dc0](https://github.com/StoneCypher/self-expression/commit/56ef1919339382232049109bce14452fef649dc0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate artifacts after the claudio merge
  * README.md, CHANGELOG*, and coverage-stoch/ rebuilt from the merged tree.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:13:47 PM

Commit [a1a6dda60bfe9f1d5d4be5c1e260b2c2a7a54c8d](https://github.com/StoneCypher/self-expression/commit/a1a6dda60bfe9f1d5d4be5c1e260b2c2a7a54c8d)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [6d38073, 8964990]

  * chore: merge origin/main (#44 claudio audio facility)
  * Source conflict was the CONFIG_KEYS pin test: unioned so it lists the eleven
audio.* keys and onboarding.answered. Generated artifacts (CHANGELOG*, README.md,
coverage-stoch/) took main's side; the rebuild regenerates them.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:11:21 PM

Commit [6d38073c8391fc7d1052a68514bcaa81710c1b92](https://github.com/StoneCypher/self-expression/commit/6d38073c8391fc7d1052a68514bcaa81710c1b92)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: first-run onboarding — question registry, ledger, and the onboard tool
  * Records the design in the plugin-layout doc and closes out the #40 work: the
questionnaire is a code-resident registry with a per-question ledger
(onboarding.answered), deliberately no completion boolean, surfaced through the
MCP handshake instructions string rather than a hook so it reaches every host.
  * Also unions the CONFIG_KEYS pin test with the new onboarding.answered key and
drops an unnecessary template expression in the dwelling-enable reply.
  * Closes #40




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:11:21 PM

Commit [d90c4a0a1ab2e79c1360bd8fade6b4027e3b5575](https://github.com/StoneCypher/self-expression/commit/d90c4a0a1ab2e79c1360bd8fade6b4027e3b5575)

Author: `John Haugeland <stonecypher@gmail.com>`

  * @
feat: first-run onboarding — question registry, ledger, and the onboard tool
  * Records the design in the plugin-layout doc and closes out the #40 work: the
questionnaire is a code-resident registry with a per-question ledger
(onboarding.answered), deliberately no completion boolean, surfaced through the
MCP handshake instructions string rather than a hook so it reaches every host.
  * Also unions the CONFIG_KEYS pin test with the new onboarding.answered key and
drops an unnecessary template expression in the dwelling-enable reply.
  * Closes #40
@