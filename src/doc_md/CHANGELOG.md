# Changelog

All notable changes to this project will be documented in this file.

63 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:48:48 AM

Commit [f1f573e8faf30c8a93d2800929515fc33fb1175e](https://github.com/StoneCypher/self-expression/commit/f1f573e8faf30c8a93d2800929515fc33fb1175e)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [90a1269, d8562eb]

  * chore: merge origin/main (#31 share keys, #41 messagebox); union the registry and its pin test
  * Source integration: audio.* keys sit alongside the new share.* and
messages.* keys in CONFIG_KEYS; the registry pin test now lists all
32 keys. surface.stoch timeouts were widened identically on both sides
(main's 30_000 spelling kept). Generated artifacts taken from main;
rebuild follows.
  * Refs #44




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:45:06 AM

Commit [d8562eb486fe72eee473113dd4f84386b5e156c9](https://github.com/StoneCypher/self-expression/commit/d8562eb486fe72eee473113dd4f84386b5e156c9)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [4be9711, 3bc0eb6]

  * Merge pull request #72 from StoneCypher/feat_26-08-28_addressivity_41
  * feat: addressivity — audience-tagged messagebox facility (#41)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:44:04 AM

Commit [90a126904484d542ff959ec4b661596e53ec0b66](https://github.com/StoneCypher/self-expression/commit/90a126904484d542ff959ec4b661596e53ec0b66)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: claudio — voluntary audio expression as its own facility (strike/audition/say)
  * The successor to the hook-triggered prototype, per the approved design in
src/superpowers/spec/2026-08-27-voluntary-audio-design.md and issue #44:
sound is voluntary, meaning-mapped, and dependency-free, or it does not
ship.
  * Own facility, structurally: src/ts/claudio/ builds into its own bundle
(dist/claudio.cjs) behind its own bin (self-expression-audio) and its own
MCP server ('claudio' in .mcp.json / gemini-extension.json), so a broken
audio stack can never take the backchannel down and the main bundles load
no player code. Zero new dependencies.
  * Mechanism as pinned: a spawned 'powershell -NoProfile -NonInteractive'
child plays a vendored WAV via System.Media.SoundPlayer.PlaySync() and
exits. Volume is applied by scaling PCM samples in Node (the player has
no volume knob); a kill timer enforces the hard duration cap. Platforms
without a player register no tools: absence degrades to silence.
  * Policy, enforced server-side and re-checked per strike:
- default off; only exactly 'true' on audio.enabled enables
- volume ceiling min(audio.volume_ceiling, CLAUDIO_VOLUME_CEILING env) —
  the env var lives where no tool call can reach, so the assistant can
  never raise it
- closed five-leitmotif vocabulary (cap six), <= 3 s assets, 10 s hard
  cap, nothing loops
- min-gap + rolling hourly budget from the ledger; attention draws a
  slightly larger budget; session-open at most once per process
- every attempt — played, refused, errored — lands in the facility's own
  audio.sqlite3 ledger; silence records nothing
- say ships at the local SAPI tier only, behind its own exact-affirmative
  gate (audio.tts_local); spoken text stays local per the #31 rule; cloud
  tiers deliberately do not exist in this build
  * audio.* keys ride the #30 registry; assets ship in assets/leitmotifs/
with the offline generation script in src/scripts/; the scarcity ethos
ships in skills/audio-expression/SKILL.md; README and plugin-layout.md
document the facility and record the in-repo scaffolding choice.
  * Deferred to their owning issues, per the spec's own gating: quiet hours
and the shared unprompted-output surface (#43), onboarding wording (#40),
the express cross-log (no sound-suitable channel exists yet), the OneCore
TTS tier, cloud TTS, and macOS/Linux players behind the same seam. The
audition tool's undetectable 'interactive conversation' gate is reduced
to fixed low volume plus its own rate allowance, as the spec flags.
  * Also widens three surface.stoch timeouts that flaked at the 5 s default
under a loaded build machine, and extends the config registry pin test
with the eleven audio keys.
  * Refs #44 — the facility core is delivered; the deferred items above
belong to #43/#40 and later platform work, so closure is left to the
human's judgment.




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:42:54 AM

Commit [3bc0eb6ead3291ae1b64cb962710983c88312fa7](https://github.com/StoneCypher/self-expression/commit/3bc0eb6ead3291ae1b64cb962710983c88312fa7)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate artifacts after merging origin/main
  * Coverage, dist bundles, README, and changelogs rebuilt green on the
merged tree (#41 messagebox atop #19 diagrams, #20 digest, #31 share).




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