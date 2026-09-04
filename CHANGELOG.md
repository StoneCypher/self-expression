# Changelog

All notable changes to this project will be documented in this file.

83 merges; 8 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__6__2">0.6.2</a>, <a href="#0__6__1">0.6.1</a>, <a href="#0__6__0">0.6.0</a>, <a href="#0__5__0">0.5.0</a>, <a href="#0__4__0">0.4.0</a>, <a href="#0__3__0">0.3.0</a>, <a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 9:09:56 PM

Commit [bd7a266c36ed5dcc9842b0a8a3a4aca177fc08ba](https://github.com/StoneCypher/self-expression/commit/bd7a266c36ed5dcc9842b0a8a3a4aca177fc08ba)

Author: `John Haugeland <stonecypher@gmail.com>`

  * refactor: drop the unread PendingItem.label, truncateLabel and LABEL_MAX (#98)
  * Both sources computed a 60-character label and nothing in production ever read it: the
notice counts by kind through describePending, and ClaimedItem.label is built straight
from the desk row or message row in pending_tools.ts. A summary carried on PendingItem was
a second copy of text that goes stale the moment the row changes, read by nobody.
  * PendingItem is now identity and timing only. The message source loses the row['text']
dance with it. No test existed solely to exercise the truncation helper, so none was
deleted; the fixtures that carried a label field lost it, and the message-source case now
asserts on `since` rather than the field that went away. pending.stoch.ts's arbitrary
drops label with no change to any property.
  * ClaimedItem's DocBlock described itself as PendingItem's four fields with a longer label;
it now says three plus label, and why the text is read at claim time rather than carried.




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 9:06:58 PM

Commit [e0063c7a1c46bc092c7e4d0a3cfe9e225de1ce42](https://github.com/StoneCypher/self-expression/commit/e0063c7a1c46bc092c7e4d0a3cfe9e225de1ce42)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: eight small corrections across the pending notice and its docs (#98)
  * - nagEpoch guards Date.parse with Number.isFinite. An unparseable `since` produced NaN in
  the fingerprint, and NaN compares unequal to itself, so one hand-edited timestamp would
  have re-announced its item every turn forever. Covered in the existing nagEpoch case.
- desk_questions.writeQuestions no longer claims its tmp+rename matches panel.mjs's own
  handlers. panel.mjs writes questions.json in place with a bare writeFileSync at every
  site; this writer is the atomic one, and the DocBlock now says so.
- desk-shell.html: a queue button disabled by a claim kept the title "do this next", which
  described an action it would not perform. It now names the claiming session.
- claim_pending's `key` describe says ids are not unique across the two namespaces and
  that `kind` narrows the claim.
- selfNotesSegment's DocBlock gains its missing `store` param line.
- PENDING_SOURCES gains an @example.
- plugin-layout.md said "All five carriers" for six; now "every carrier".
- README/base_README Portability: recall's reply is no longer bare JSON once a notice is
  appended, so a machine consumer splits on the final "\n\n— ". Verified the separator
  against withPendingNotice and confirmed recall is the only JSON-returning carrier.




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 9:02:37 PM

Commit [d43193c2f73eaf632bf236ed31d9ce1108282ec1](https://github.com/StoneCypher/self-expression/commit/d43193c2f73eaf632bf236ed31d9ce1108282ec1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * test: cover messages.enabled=false on the pending-notice path (#98)
  * The messagebox kill switch was covered on the claim path but not on the notice path, so
nothing held the notice to it. The new case proves both halves: mail alone with the switch
off is silent and stores no fingerprint, and a desk request alongside it still speaks
without ever mentioning the muted mail.
  * Verified non-vacuous by mutation — removing the gate in the message source makes the case
fail with "pending: 1 unread message".




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 9:00:37 PM

Commit [820d420eb0cf7303686e501ec0eb4513939734c3](https://github.com/StoneCypher/self-expression/commit/820d420eb0cf7303686e501ec0eb4513939734c3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs: SKILL.md names the pending: segment and claim_pending (#98)
  * The model-facing skill described the Mailbox: segment but never the pending: one beside
it, leaving the line to be read cold. The new paragraph sits with the count-line etiquette
it belongs to: what the segment names, that it is a change signal rather than a status bar
and re-speaks only after pending.nag_hours, that claim_pending takes an item and returns
the whole text, and that claiming is the point rather than outlasting the line.
  * It also states that an unread self note is counted in both the Mailbox: and pending:
segments on purpose — #98 asked to keep both, and without saying so the overlap reads as a
double-report worth suppressing.




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 8:59:36 PM

Commit [7c957df38fb56c104b8fcc68ad959763e2e99b5a](https://github.com/StoneCypher/self-expression/commit/7c957df38fb56c104b8fcc68ad959763e2e99b5a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: pending_notice obeys retention.days like every other timestamped table (#98)
  * pruneExpired deleted from every timestamped table except pending_notice, so a fingerprint
row outlived the horizon the user configured — session-shaped residue of exactly the kind
retention exists to clear.
  * The new Pruned.pendingNotice field counts what went. Losing a row costs one
re-announcement of a backlog the session already knew about, which is much the cheaper
side of the trade. The README retention row listed only entries and turn_context and was
already behind the code; it now names the by-age tables and the by-orphanhood ones
separately.




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 8:56:00 PM

Commit [8b6ef346a49a3db692eed39eaf3415c1b2b24af0](https://github.com/StoneCypher/self-expression/commit/8b6ef346a49a3db692eed39eaf3415c1b2b24af0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: a swallowed source failure never reports "pending: clear" (#98)
  * collectPending swallowed a source throw whole, so a corrupt questions.json read as an
empty queue: the notice announced the backlog was clear and stored the empty fingerprint,
making the lie stick until the set changed again. That is the exact "the request goes
quiet" failure #98 exists to end.
  * collectPendingWithFailures now returns { items, failed }, naming the sources whose read
threw; collectPending is a thin wrapper over its items, so existing callers are untouched.
pendingNotice stays silent and stores nothing when the set is empty only because a source
failed, leaving the remembered fingerprint for the next healthy read to decide. A
non-empty set with a failed source still speaks, under-counting as before.




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 8:56:00 PM

Commit [52d1396055dad10c038c005503de6e65c9570dad](https://github.com/StoneCypher/self-expression/commit/52d1396055dad10c038c005503de6e65c9570dad)

Author: `John Haugeland <stonecypher@gmail.com>`

  * @
fix: a swallowed source failure never reports "pending: clear" (#98)
  * collectPending swallowed a source throw whole, so a corrupt questions.json read as an
empty queue: the notice announced the backlog was clear and stored the empty fingerprint,
making the lie stick until the set changed again. That is the exact "the request goes
quiet" failure #98 exists to end.
  * collectPendingWithFailures now returns { items, failed }, naming the sources whose read
threw; collectPending is a thin wrapper over its items, so existing callers are untouched.
pendingNotice stays silent and stores nothing when the set is empty only because a source
failed, leaving the remembered fingerprint for the next healthy read to decide. A
non-empty set with a failed source still speaks, under-counting as before.
@




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 7:59:15 PM

Commit [0fb69697cf37395e86d49d6e1de2d5ba824061ab](https://github.com/StoneCypher/self-expression/commit/0fb69697cf37395e86d49d6e1de2d5ba824061ab)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(desk): reflow a wrapped issue reference that markdown lint read as a heading (#93)




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 7:27:41 PM

Commit [3fc3fb20a713a40e6cfd0e37a4066c1d0465ec31](https://github.com/StoneCypher/self-expression/commit/3fc3fb20a713a40e6cfd0e37a4066c1d0465ec31)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs: list_card_types bare call lists names by category (#93)




&nbsp;

&nbsp;

## [Untagged] - Sep 3, 2026 7:19:55 PM

Commit [78539d25d21b42c95d1fc55997e4adfe3b4e2d79](https://github.com/StoneCypher/self-expression/commit/78539d25d21b42c95d1fc55997e4adfe3b4e2d79)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix(cards): close the answer-stamp window, and the review's remaining small findings (#93)
  * `writeAnswerCard`'s read-parse-stamp-write now runs inside a `try`, removing the card directory
before rethrowing: an unstamped card is not an answer, so `listAnswerCards` skips it and
`ageOutAnswers` could never remove it — it would squat on a band ord forever. Process death
inside the window still leaves one, and the DocBlock now says exactly that much and no more.
Two tests cover it: a `card.json` the stamp cannot parse, and one that parses to a non-object.
  * Also:
- `conventions.ts`: the pointer's reasoning said "all seven" against a registry of eight; its
  `@example` said "(7 documents)" for the same reason. Both now say eight.
- `kit.ts`: `CardMeta.contains` and `CategoryGroup`'s `settings` each get the clause they were
  missing — `contains` marks a type that legitimately emits several `<section>`s and is what
  `kit.audit`'s section-count rule keys on; `settings` is `Object.keys(meta.defaults)`.
- `kit.ts`: `describeKit`'s preamble now names the taste document, the
  `self-expression://conventions/answer-cards` resource, at the point of decision. The trigger
  sentence still leads.
- `answer.ts`: `ANSWER_ORD_BASE` and `ANSWER_ORD_SPAN` carry the `: number` annotations the plan
  specified, so the exported type is `number` rather than the literal.
- `config.ts`: `dwelling.size_warn_gb` moves back beside its family, leaving the two `desk.*`
  keys together at the end — the order the README table already documents.
- `desk_panel.spec.ts`: `afterEach` awaits the child's `exit` before removing the desk directory,
  which the panel holds recursive `watch` handles on; `startPanel` clears its 8 s failure timer
  once the port is reported.
- `desk.md`: a warning that the kit's own `newcard.mjs rebuild --deck` regenerates every
  `card.json` from its recorded spec and so strips `answer` and `fixed` from every card.