# Changelog

All notable changes to this project will be documented in this file.

61 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:39:43 AM

Commit [cb24f7619f8c7fa04859771316bfccd13fbfbf32](https://github.com/StoneCypher/self-expression/commit/cb24f7619f8c7fa04859771316bfccd13fbfbf32)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [b5ca98a, 4be9711]

  * Merge remote-tracking branch 'origin/main' into feat_26-08-28_addressivity_41
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
#       coverage-stoch/ts/channels/migrate.ts.html
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
#       coverage-stoch/ts/mcp/dwell_tool.ts.html
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
#       coverage-stoch/ts/tests/helpers/index.html
#       coverage-stoch/ts/tests/helpers/v1_fixture.ts.html
#       dist/index.cjs.map
#       dist/index.iife.js.map
#       dist/index.mjs.map
#       src/doc_md/CHANGELOG.long.md
#       src/doc_md/CHANGELOG.md
#       src/doc_md/plugin-layout.md
#       src/ts/mcp/server.ts
#       src/ts/tests/config.spec.ts
#       src/ts/tests/config.stoch.ts




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:36:18 AM

Commit [b5ca98a4afcaf4cc502257f7c5d42afbed33b7f5](https://github.com/StoneCypher/self-expression/commit/b5ca98a4afcaf4cc502257f7c5d42afbed33b7f5)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: addressivity — audience-tagged messagebox facility
  * Implements the 2026-08-27 addressivity design (its own facility, never a
rendered channel): messages live in the store, not the transcript.
  * - AUDIENCES vocabulary (self/agents/user/record) in the vocabulary → zod
  → SQL CHECK pattern; an invalid audience is unnameable
- messages table plus append-only message_reads receipts; unread is a
  computed predicate (no receipt from this reader, not expired); expiry
  excludes from delivery and never deletes
- SCHEMA_VERSION 2→3 as a purely additive MigrationStep on the #42 chain
- channels/messages.ts: postMessage / readMessages / unreadCounts with
  session-fenced self, box-fenced agents (receipt key agent_id falling
  back to session), user mail never receipted by the model, record never
  unread; 2000-char cap; replyTo must exist
- MCP tools post_message / read_messages, identity adopted from
  turn_context as express does; messages.enabled is a per-call kill
  switch; reading agents requires a box
- hooks: config-gated Mailbox count line on UserPromptSubmit
  (messages.notify), SessionStart handler injecting unread self notes on
  compact/resume and receipting them (messages.enabled alone);
  SessionStart registered in hooks.claude.json
- self-expression messages CLI subcommand — the user's own door; --ack
  writes the human's receipts, user audience only
- retention: messages pruned by age, receipts only by orphanhood
- config keys messages.enabled / messages.notify in CONFIG_KEYS
- unit + stochastic tests (frozen v2 fixture; migration losslessness;
  at-most-once delivery, fencing, append-only invariants); README,
  plugin-layout, SKILL.md addressivity section
  * Closes #41




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:30:21 AM

Commit [1edcfc78ab272f0f28cdc11919f8f28aa22b15ad](https://github.com/StoneCypher/self-expression/commit/1edcfc78ab272f0f28cdc11919f8f28aa22b15ad)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 4be9711a4faa0c18972a439447199475dda9dbbb




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:28:57 AM

Commit [4be9711a4faa0c18972a439447199475dda9dbbb](https://github.com/StoneCypher/self-expression/commit/4be9711a4faa0c18972a439447199475dda9dbbb)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [384486c, 29484e2]

  * Merge pull request #70 from StoneCypher/feat_26-08-28_structured-aggregation_31
  * feat: public aggregation carries structured fields only, never free text (#31)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:27:04 AM

Commit [29484e2ad36d069d9444658c3932f948cf649e92](https://github.com/StoneCypher/self-expression/commit/29484e2ad36d069d9444658c3932f948cf649e92)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: rebuild artifacts on the merged tree (build green, exit 0)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:26:51 AM

Commit [c503ac63d02bc1d9c4b6ace54f91b6e75ad4a800](https://github.com/StoneCypher/self-expression/commit/c503ac63d02bc1d9c4b6ace54f91b6e75ad4a800)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [601b81f, 384486c]

  * Merge remote-tracking branch 'origin/main' into feat_26-08-28_voluntary-audio_44




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:25:17 AM

Commit [db54ef9cc4453057d85c92bf104ba578e7b23b10](https://github.com/StoneCypher/self-expression/commit/db54ef9cc4453057d85c92bf104ba578e7b23b10)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [676e7ad, 384486c]

  * chore: merge origin/main (#19 diagrams, #20 digest); union tool registrations, keep 60s stoch timeouts




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:23:21 AM

Commit [a34324c4ca73bb3983f19062c2cadccccd6cc564](https://github.com/StoneCypher/self-expression/commit/a34324c4ca73bb3983f19062c2cadccccd6cc564)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 384486ce866b48bc68390bde01963c10a3a7ff7c




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:22:33 AM

Commit [e6126629f4edd8c45dbc4aa1fa42f31776c7508c](https://github.com/StoneCypher/self-expression/commit/e6126629f4edd8c45dbc4aa1fa42f31776c7508c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: post-checkpoint test work rescued after agent hit session rate limit mid-write




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:22:15 AM

Commit [384486ce866b48bc68390bde01963c10a3a7ff7c](https://github.com/StoneCypher/self-expression/commit/384486ce866b48bc68390bde01963c10a3a7ff7c)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [52dc11c, 1c6d59b]

  * Merge pull request #73 from StoneCypher/feat_26-08-28_compression_20
  * feat: treat compression as the mechanic, not lists — digest core, profiles, render_digest, verifyDigest (#20)