# Changelog

All notable changes to this project will be documented in this file.

64 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:55:17 AM

Commit [2ec684e6ccbf91650eef4a34e636bd2c5f37bcb1](https://github.com/StoneCypher/self-expression/commit/2ec684e6ccbf91650eef4a34e636bd2c5f37bcb1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs: onboarding etiquette in the skill and README onboarding section (wip, refs #40)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:54:25 AM

Commit [a53119778fc5642e931c887589b7da5240401deb](https://github.com/StoneCypher/self-expression/commit/a53119778fc5642e931c887589b7da5240401deb)

Author: `John Haugeland <stonecypher@gmail.com>`

  * test: onboarding unit and stochastic suites (wip, refs #40)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:54:16 AM

Commit [b2629687bfa08a1545f9b801ad27acac19487905](https://github.com/StoneCypher/self-expression/commit/b2629687bfa08a1545f9b801ad27acac19487905)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 896499021606d732e5aeafd7bf36a95320fabde9




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:53:00 AM

Commit [896499021606d732e5aeafd7bf36a95320fabde9](https://github.com/StoneCypher/self-expression/commit/896499021606d732e5aeafd7bf36a95320fabde9)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [d8562eb, d3fec48]

  * Merge pull request #71 from StoneCypher/feat_26-08-28_voluntary-audio_44
  * feat: claudio — voluntary audio expression as its own facility (strike/audition/say)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:51:49 AM

Commit [95b4285ccf10177a02d0e3fb6b167d2987c1fc77](https://github.com/StoneCypher/self-expression/commit/95b4285ccf10177a02d0e3fb6b167d2987c1fc77)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: onboarding question registry, ledger, and onboard MCP tool (wip, refs #40)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 11:51:45 AM

Commit [d3fec489e7e1df2ca1385a6470de67afa851b398](https://github.com/StoneCypher/self-expression/commit/d3fec489e7e1df2ca1385a6470de67afa851b398)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate artifacts after the share/messagebox merge
  * dist, coverage, README, and changelogs regenerated on the merged tree;
full build green (exit 0).
  * Refs #44




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