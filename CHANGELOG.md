# Changelog

All notable changes to this project will be documented in this file.

71 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 2:17:50 PM

Commit [5843e94ecfcf768307f5c8b6f254ecef858cb598](https://github.com/StoneCypher/self-expression/commit/5843e94ecfcf768307f5c8b6f254ecef858cb598)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: retraction tests, stochastic properties, README/layout/skill docs




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 2:02:48 PM

Commit [2484a1ef477186ee685f4ba3764ef8c483ca6f2e](https://github.com/StoneCypher/self-expression/commit/2484a1ef477186ee685f4ba3764ef8c483ca6f2e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: retraction marks the original (#16) — vocabulary, schema v6, standing, register, tools, hook




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:41:08 PM

Commit [931f44e23cc3e4455a5473e1b01003d9af25bfc2](https://github.com/StoneCypher/self-expression/commit/931f44e23cc3e4455a5473e1b01003d9af25bfc2)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: ca657f213272a88d1d43d3a6bc6781f9ad9fec6a




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:39:33 PM

Commit [ca657f213272a88d1d43d3a6bc6781f9ad9fec6a](https://github.com/StoneCypher/self-expression/commit/ca657f213272a88d1d43d3a6bc6781f9ad9fec6a)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [2da163d, e0509ea]

  * Merge pull request #81 from StoneCypher/feat_26-08-28_self-initiated-speech_43
  * feat: held notes — self-initiated speech with provable delivery (#43)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:36:11 PM

Commit [e0509ea559c6cae508c5e8b76dc036b542e0f0ea](https://github.com/StoneCypher/self-expression/commit/e0509ea559c6cae508c5e8b76dc036b542e0f0ea)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: held notes — self-initiated speech with provable delivery (#43)
  * Agency over WHEN to speak, built so the assistant can never believe more
about a message's fate than the system can prove.
  * The discipline, enforced rather than promised: compose on any turn; deliver
only on a human's turn. A wakeup may write a note; it may not deliver one.
The sole delivery vehicle is the UserPromptSubmit hook riding the next
human-initiated turn, checked against the hook-supplied TURNS ground truth.
  * Schema v5, purely additive: `notes` is a sidecar on #41's `messages` rather
than a rival store — a note is an audience-`user` message plus `not_before`,
`reason`, and `series_key` — and `note_events` is an append-only ledger whose
`turn` column carries the hook-supplied turn type. State is derived from that
ledger by a pure `deriveNoteState`, never stored, so it cannot drift from the
record that justifies it.
  * The ladder is queued -> offered -> surfaced, with expired and withdrawn
terminal. There is deliberately no `read` state: nothing in this stack
observes a human reading anything, so `surfaced` — "rendered into a reply the
human explicitly prompted" — is the ceiling, and a false belief about
delivery is structurally inexpressible rather than merely discouraged.
`offerRipeNotes` refuses any turn but `reply`; `surfaceNote` refuses unless a
matching hook-written offer exists for the same prompt_id.
  * Failure modes foreclosed mechanically: nagging (per-turn budget, rolling-24h
cap, offer cap then expiry, mandatory TTL, series dedupe), performing
(mandatory stated reason plus an audit surface that shows the notes that
died; nothing ever prompts "consider writing a note"), manipulating
(mandatory provenance on every surfaced note), false delivery (the vocabulary
itself), groundhog-day resends (series supersede plus the permanent ledger),
and cross-host drift (no hook means held longer, never claimed delivered).
  * Off by default behind `mailbox.enabled`, asked at onboarding, with five
numeric budgets, a kill switch covering every moment, and the hook check
inside the existing fail-open boundary. Adds post_note, withdraw_note,
surface_note, and list_notes, a read-only `self-expression notes` CLI door,
surfacing guidance in the skill, and retention pruning the note tables by
orphanhood with their messages.
  * Closes #43




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 1:32:13 PM

Commit [79e589dfe2cdbc766db73bbd6bd6975bb0c9475c](https://github.com/StoneCypher/self-expression/commit/79e589dfe2cdbc766db73bbd6bd6975bb0c9475c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * wip: docs, skill guidance, and lint fixes for held notes




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