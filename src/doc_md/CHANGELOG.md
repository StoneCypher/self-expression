# Changelog

All notable changes to this project will be documented in this file.

65 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





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