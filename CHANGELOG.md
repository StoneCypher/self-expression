# Changelog

All notable changes to this project will be documented in this file.

72 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 5:45:28 PM

Commit [033de66aeccff43b5e023da87170d727c052818e](https://github.com/StoneCypher/self-expression/commit/033de66aeccff43b5e023da87170d727c052818e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(config): window.browser and window.editor postures, and an enum kind
  * Two new registry keys say whether a page may be put on the user's screen,
each an enum over never / ask / always, defaulting to ask.
  * - config: fourth kind `enum`, carrying its permitted values on the key
  definition. The existing choiceValidator is the enum validator — it already
  canonicalizes case-insensitively to lowercase and rejects outside the set,
  naming the set in describeVocabulary shape. A bool cannot express three
  states, and a string kind would make the rejection say "kind: string" where
  the useful message is "one of: never, ask, always".
- config: WINDOW_SURFACES / WINDOW_POSTURES / DEFAULT_WINDOW_POSTURE,
  windowPostureKey, and the tolerant windowPosture reader — an invalid stored
  row reads as ask (D5), the safe direction, never as permission.
- config: share.time_granularity moves from kind string to kind enum. It has
  always used choiceValidator; the kind was simply the closest available label
  before enum existed, and its rejection improves for free.
- hooks: onUserPromptSubmit appends a `windows:` segment to additionalContext
  beside #42's conventions flags and #76's lengths, on D9's mechanism. Fails
  open on its own terms like every other segment.
  * Two keys rather than one because the costs differ: an external browser window
steals focus and may land while nobody is at the machine, while an editor tab
appears in the window the user is already sitting in. One key would force the
expensive answer onto the cheap case.
  * Advisory by construction — there is deliberately no enforcing tool. Nothing
can stop a shell command from opening a window, so a gate would be a lock on
one of several doors, and a lock that can be walked around is worse than an
honest request.
  * - tests: registry (both keys validate their own defaults; every enum key
  carries a non-empty choice set and no other kind does; mixed-case
  canonicalization; rejection names the whole set), reader, effective listing,
  and every posture-by-surface hook sentence
- stochastic: arbitrary strings outside the vocabulary never write, and
  arbitrary case permutations round-trip store to read to posture
- docs: base_README config table plus a window-posture section, and the config
  surface paragraph in src/doc_md/plugin-layout.md




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 2:31:11 PM

Commit [6b07359b5a5c313cbd1fb9756d5ae5b8fc09c8e3](https://github.com/StoneCypher/self-expression/commit/6b07359b5a5c313cbd1fb9756d5ae5b8fc09c8e3)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 4ecc9b12ec69e5c0072ceb50464b8afacf11f98a




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 2:29:34 PM

Commit [4ecc9b12ec69e5c0072ceb50464b8afacf11f98a](https://github.com/StoneCypher/self-expression/commit/4ecc9b12ec69e5c0072ceb50464b8afacf11f98a)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [ca657f2, 0fff283]

  * Merge pull request #82 from StoneCypher/feat_26-08-28_retraction_16
  * feat: retraction marks the original, not just the correction (#16)




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 2:25:50 PM

Commit [0fff2832d33c3f87d31317e7682ab46d0357cd5f](https://github.com/StoneCypher/self-expression/commit/0fff2832d33c3f87d31317e7682ab46d0357cd5f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: retraction marks the original, not just the correction (#16)
  * Implements src/superpowers/spec/2026-08-27-retraction-design.md. The
load-bearing property is mark, never mutate: "retracted" is derived at read
time from the corrects_id chain and is never written onto the original row.
  * - vocabulary: CORRECTION_KINDS (retracts / amends / resolves), needed because
  #42 forecast resolutions already share the corrects_id chain
- schema v6: nullable corrects_kind (CHECK) and verbatim, plus
  idx_entries_corrects; the v5-to-v6 step is a table rebuild through the
  shared recipe, with a frozen v5 fixture round-trip
- entries: cross-field correction rules, effectiveCorrectionKind carrying the
  legacy read rule, standingOf (one query per batch), and the register
- marked read surfaces: recentEntries gains the link columns and derived
  status/by, recall gains retractions, express gains correctsKind and
  verbatim and echoes the target it corrects
- analytics: seriesPercents excludes retracted snapshots, previousSignature
  skips a retracted signature; both document the exclusion at the query
- hooks: first-turn retraction replay gated by retraction.replay, default on
- stochastic: standing agrees with an independent naive fixpoint, and no
  operation sequence mutates or deletes an existing row
- docs: base_README, plugin-layout, and the skill Retraction section
  * Closes #16




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