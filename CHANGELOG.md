# Changelog

All notable changes to this project will be documented in this file.

70 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:25:39 PM

Commit [a04fc493ffe3a051ba09203b5dae16d84f46c503](https://github.com/StoneCypher/self-expression/commit/a04fc493ffe3a051ba09203b5dae16d84f46c503)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: held-note unit, tool, hook, and stochastic tests




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:16:35 PM

Commit [b11d52e0b86b86bd1b8d99b9e929d54decfe52dd](https://github.com/StoneCypher/self-expression/commit/b11d52e0b86b86bd1b8d99b9e929d54decfe52dd)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: held notes core — schema v5, notes.ts, tools, hook offer path




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:01:12 PM

Commit [2da163dbb0c2c478ec1555892d1f54415fd7f297](https://github.com/StoneCypher/self-expression/commit/2da163dbb0c2c478ec1555892d1f54415fd7f297)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [8fc723d, 9f7a387]

  * Merge pull request #80 from StoneCypher/feat_26-08-28_anchoring_18
  * feat: anchoring — commentary bound to a location instead of floating in prose (#18)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 12:58:22 PM

Commit [9f7a387f8d2d47877cebc2e07070fb8618a010d3](https://github.com/StoneCypher/self-expression/commit/9f7a387f8d2d47877cebc2e07070fb8618a010d3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate artifacts after merging origin/main




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