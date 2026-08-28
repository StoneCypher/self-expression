# Changelog

All notable changes to this project will be documented in this file.

69 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:56:04 PM

Commit [66da9d12a8c7b155fa3c06491e459e3a8b44dd20](https://github.com/StoneCypher/self-expression/commit/66da9d12a8c7b155fa3c06491e459e3a8b44dd20)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [cbd6324, 8fc723d]

  * merge: origin/main into anchoring — annotate honours the #76 per-channel length budget




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:51:05 PM

Commit [cbd63246ad55f3cd6fdc60a54d1b974e548c2b9d](https://github.com/StoneCypher/self-expression/commit/cbd63246ad55f3cd6fdc60a54d1b974e548c2b9d)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: anchoring — commentary bound to a location instead of floating in prose
  * Implements the anchoring design: an expression entry can carry a machine-readable
pointer to the thing it is about, plus the rendering that makes it read as
attached and the resolution rules for when the target moves or vanishes.
  * Five addressable kinds (file, prompt, reply, checklist, entry) as a new closed
vocabulary, and five nullable qualifier columns on entries — anchor_kind (CHECK-
constrained), anchor_target, anchor_span, anchor_quote, anchor_hash — in the
typed-silence pattern rather than a separate table or a new channel, because an
anchored dissent is still a dissent. One new index, idx_entries_anchor.
  * Schema version 4. The v3 to v4 step is a table rebuild, since anchor_kind's CHECK
cannot be added in place; the recipe v1 to v2 already used is extracted as one
shared rebuildEntries that both steps call.
  * channels/anchors.ts adds normalization, the SHA-256 fingerprint, span grammar, and
the pure read-time resolvers behind the fresh to moved to orphaned ladder.
Resolution is computed and never stored, and matching is exact-normalized only:
two identical candidates degrade to orphaned rather than guess, because a note
pinned to the wrong line is worse than an orphan, and an orphan degrades to
today's floating-prose behavior rather than below it.
  * charts/annotations.ts adds renderAnnotations for the grouped block and
renderAnchorSegment for a single anchored line, following the house renderer
contract, with verdicts passed in so the renderers stay pure.
  * express grows four optional anchor arguments with the hash derived server-side and
a prompt anchor adopting the observed turn; the new annotate tool takes 1 to 25
notes, all-or-nothing in one transaction, and returns the canonical block.
recall widens to carry the anchor columns.
  * privacy.store_quotes joins the config registry: a prompt quote is dropped at write
while anchor_hash still records, so drift detection and public aggregation carry
no words. anchor_kind exports verbatim, anchor_hash re-blinded under the
per-submission salt, and target, span, and quote never export.
  * Two incidental fixes the change forced: openStore now applies indices after
migrating rather than before, since an index over a newly-migrated column cannot
be created against the old table shape; and the v1/v2 fixtures freeze their own
index list rather than importing the live one, which would drift forward with the
schema.
  * Closes #18




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:36:59 PM

Commit [6c6110910ba623636a2cd62ed29bd8c9b23cea09](https://github.com/StoneCypher/self-expression/commit/6c6110910ba623636a2cd62ed29bd8c9b23cea09)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 8fc723d70cc1372df3cb2f894f592dd261ed126e




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:36:16 PM

Commit [d7424964c5cacd9802105c89f3fe50ee893d366b](https://github.com/StoneCypher/self-expression/commit/d7424964c5cacd9802105c89f3fe50ee893d366b)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: anchoring tests — resolver, renderer, migration, tools, stochastic




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:35:42 PM

Commit [8fc723d70cc1372df3cb2f894f592dd261ed126e](https://github.com/StoneCypher/self-expression/commit/8fc723d70cc1372df3cb2f894f592dd261ed126e)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [28b41be, feef2ea]

  * Merge pull request #77 from StoneCypher/feat_26-08-28_channel-text-lengths_76
  * feat: per-channel text length, user-configurable, defaults raised to 200




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:34:38 PM

Commit [feef2ea14fed5ec07a5b8102a88461779f2c3826](https://github.com/StoneCypher/self-expression/commit/feef2ea14fed5ec07a5b8102a88461779f2c3826)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: rebuild generated artifacts after merging origin/main (#40 onboarding)




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