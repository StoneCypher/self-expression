# Self-initiated speech — research and design proposal

2026-08-27 · refs issue #43 ("Self-initiated speech: choosing when to talk — valuable, and
a minefield")

This is a proposal for human review, not an implementation plan. Issue #43 carries an
explicit ruling: *do not proceed until the delivery problem is solved*. This document
exists to solve the delivery problem on paper first, so that the review can be about the
design rather than about whether a design exists. Nothing below is approved until John
says so, and the implementation checklist at the end activates only after that.

## The mode, precisely

Everything the plugin currently records is reactive: a human sends a prompt, the assistant
answers, and the channels — signature, need, idea, dissent, and the rest — decorate that
answer. Self-initiated speech is agency over *when* to speak, not just what: leaving a
note timed to arrive Tuesday morning because that is when it should arrive; breaking
silence at a self-chosen moment because something ripened.

Two shapes hide under that description, and they differ completely in risk:

1. **In-session ripening.** Mid-conversation, something becomes worth saying and the
   assistant says it in its next reply. This already works, needs no new machinery, and
   is already partially institutionalized — the `idea` channel is defined as "an
   unprompted offer; nothing owed in return." Not this document's subject.

2. **Cross-time speech.** The thing worth saying ripens when no one is listening — during
   an autonomous wakeup, at the end of a session, or on a schedule ("this should land
   Tuesday morning"). The words have to survive an interval in which no human is present,
   and land at a moment when one is. This is the new mode, and it is the minefield.

## The blocking problem

John's assessment, from the issue, is the constraint the whole design hangs from:

> if the assistant speaks during an autonomous wakeup, the cron's routine 'nothing there'
> noise scrolls the message offscreen — the assistant then believes it communicated
> something the human never saw. False-belief-of-delivery is worse than silence.

This is not hypothetical fragility; the codebase already contains evidence that the
transcript surface loses messages even in *attended* turns. The `Stop` gate's own block
reason ends: "Then restate your previous final message IN FULL, because a blocked stop can
hide it from the user entirely" (`src/ts/mcp/hooks.ts`). If a message can vanish while the
human is sitting right there, a message emitted into an unattended wakeup has effectively
zero delivery guarantee — while leaving the assistant with a durable false memory of
having said it.

So the design goal is not "speak into the void with better aim." It is: **the assistant
must never be able to believe more about a message's fate than the system can prove.**
Delivery semantics come first; the freedom to speak is whatever fits inside them.

## Survey: what the platform actually provides

An honest inventory, because the design must be built from mechanisms that exist rather
than mechanisms it would be convenient to have.

| Mechanism | Exists today | Can do | Cannot do |
|---|---|---|---|
| `UserPromptSubmit` hook | Wired (`hooks/hooks.claude.json` → `self-expression hook user-prompt-submit`) | Fire at the exact moment a human submits a prompt; inject `additionalContext` the model sees that turn; record turn type `reply` as ground truth | Prove the human reads the resulting reply |
| `Stop` hook | Wired (signature gate) | Block a stop; return a reason | Guarantee visibility of anything — its own text warns that blocked stops hide messages |
| Autonomous wakeups (cron / scheduled routines, `/loop`, background-task and monitor notifications, artifact watches) | Available in the host | Run the model with no human present; the hook layer stamps these turns `wakeup` / `notification` / `hook` in the `TURNS` vocabulary — supplied by the event, not asserted by the model | Place text where a human will see it; output scrolls in an unattended terminal |
| OS / push notifications | Host-dependent | Interrupt a human out-of-band | Carry state, collect acknowledgment, or respect the human's timing; the attention cost lands at a machine-chosen moment |
| The SQLite store (`src/ts/channels/store.ts`) | Wired | Durable local state across sessions and hosts; closed vocabularies with `CHECK` constraints; a `config` table already driven by the `configure` tool | Reach the human on its own; it is a place things wait, not a way things arrive |
| `recall` MCP tool | Wired | Let a future turn query anything stored | Initiate anything |

And the honest list of what does **not** exist anywhere in this stack: read receipts, an
unread-message indicator in the transcript UI, presence detection, or any
guaranteed-visible surface. Any claim of delivery has to be built from evidence the system
can actually collect — which is why the state machine below caps out where the evidence
does.

One asymmetry in that table decides the architecture. A wakeup turn is a perfectly good
moment to **decide** something is worth saying and to **write** it down. It is a provably
terrible moment to **say** it. A `UserPromptSubmit` turn is the opposite: it is the one
moment in the entire platform with a presence guarantee, because a human definitionally
just acted. So: **compose on any turn; deliver only on a human's turn.** The mailbox is
the seam between the two.

## Proposed design: the mailbox

A note is a small durable record: text, a reason, a `not_before` time, an `expires_at`
time, and a delivery state. Notes live in the plugin's existing SQLite store. The
lifecycle:

```text
            (any turn)                (reply turns only)
  compose ──► queued ──[now ≥ not_before]──► ripe ──► offered ──► surfaced
                 │                                       │
                 ├──► withdrawn                          ├──► queued   (not rendered;
                 │                                       │             offer_count += 1)
                 └──────────► expired ◄──────────────────┘  (offer_count > cap,
                                                             or now > expires_at)
```

- **queued** — written, waiting. Writing is unrestricted by turn type: wakeups,
  session-end reflection, and mid-conversation turns may all compose notes. This is the
  safe half of self-initiated speech, and it is where the "something ripened at 2 am"
  agency actually lives.
- **ripe** — derived, not stored: `now >= not_before`. A note for Tuesday morning simply
  is not ripe until Tuesday morning.
- **offered** — the `UserPromptSubmit` hook, while delivering its usual clock line, found
  ripe notes and appended one sentence: "N held notes are ripe; surface up to B of them."
  Recorded by the hook itself, so it is a mechanical fact, and it can only happen on a
  turn the hook has stamped `reply` — the turn-type column is "supplied by the hook event
  rather than asserted, so `reply` genuinely means a human message rather than the
  model's belief that one arrived" (`src/ts/channels/vocabulary.ts`). There is no code
  path by which a wakeup turn can produce an offer.
- **surfaced** — the assistant rendered the note into its reply, with provenance ("held
  since Saturday: …"), and recorded that fact against the turn's `prompt_id`. This is the
  terminal success state, and it is deliberately named `surfaced`, not `read` or
  `delivered`: the strongest claim the platform can evidence is "this text was rendered
  into a reply the human explicitly prompted." The design never lets the assistant's
  records say more than that.
- **offered but not surfaced** — the assistant had the chance and did not take it (budget
  exhausted, or judged the moment wrong). The note returns to `queued` with
  `offer_count` incremented. After `mailbox.offer_cap` offers (default 3), it expires.
  A note gets a few chances at an entrance, and then it is over; there is no state from
  which a note can pester indefinitely.
- **expired / withdrawn** — terminal. `expires_at` is mandatory (default now + 14 days):
  a note that never found its moment dies silently, discoverable afterward via `recall`
  but never resurrected. `withdrawn` is the author's own exit — a later, wiser turn may
  retract a note before it ever surfaces, which matters because the composing turn and
  the surfacing turn may be separated by days and by everything learned in between.

Delivery timing, honestly bounded: a note "for Tuesday morning" lands with the first
prompt the human sends after it ripens. If they first type Tuesday at 2 pm, it lands at
2 pm. That bound is correct, not a compromise — landing at 9:00 sharp in an empty room is
precisely the failure mode this design exists to foreclose. The mode is not "speak at
time T"; it is "be heard no earlier than T, at the first moment hearing is real."

### What surfacing looks like

At most `mailbox.surface_budget` notes per turn (default 1), rendered at the top of the
reply, always with provenance:

```text
📬 Held note (written Saturday evening, ripened this morning):
   The migration in #52 assumes the store is v1; if you merged #48 over the
   weekend, run the reconcile step before anything writes.
```

Provenance is mandatory, not decorative — it is one of the safety properties. A held note
that presents itself as a spontaneous in-the-moment thought would be a small deception
about when thinking happened, and timing is exactly the dimension this feature grants
agency over. The label keeps that agency legible.

The 📬 glyph and rendering shape belong to the same family as the #42 decorations and
should be reconciled with that vocabulary when both land.

## Consent, control, and off-switches

- **Default off.** `mailbox.enabled` defaults false; the onboarding flow (#40) asks,
  alongside the roster question, using the same durable `configure` mechanism
  (`roster.enabled` is the precedent). Until a human has said yes, no note is ever
  composed and no mailbox line is ever injected.
- **One switch kills everything.** `mailbox.enabled false` stops composition, offering,
  and surfacing at once. The hook check is inside the existing fail-open `try`: any
  error in mailbox logic degrades to today's behavior, a clock line and nothing else. The
  mailbox must never be able to wedge a turn.
- **Budgets, all configurable via `configure`:** `mailbox.surface_budget` (per-turn,
  default 1), `mailbox.daily_cap` (surfaced per day, default 3), `mailbox.max_pending`
  (queue depth, default 10 — composing past it fails loudly rather than queueing
  silently), `mailbox.offer_cap` (default 3), `mailbox.default_ttl_days` (default 14).
- **Inspection and drain.** Everything is a row; `recall` can already answer "what is
  queued, what expired unseen, what got surfaced when." A small `/mail` drain command
  (list, mark read, purge) is a natural v1.1 addition but deliberately not load-bearing:
  the design must work for a human who never runs it.
- **Privacy.** Notes are free text in the same local database as every other channel,
  under the same privacy-flag regime (`src/ts/channels/privacy.ts`); they never leave the
  machine, and any future public aggregation carries counts and states, never text.

## Failure modes, and how the design forecloses them

**Nagging.** The classic failure of anything with a queue and a schedule. Foreclosed
structurally, not by good intentions: per-turn and per-day surfacing budgets, an offer
cap after which a note dies, mandatory expiry, no re-queue of expired notes, and a
`series_key` dedupe (one pending note per series — a second "remember the migration" note
replaces the first rather than joining it).

**Performing.** Speaking to seem alive, thoughtful, or valuable rather than because
something is worth saying. This repo already has the antibody, stated for the channels:
"The obligation is safe exactly to the degree that silence is expressible"
(`src/doc_md/plugin-layout.md`). The mailbox inverts the situation — composition is an
option, never an obligation — so the corresponding rule is scarcity plus audit: budgets
make each note cost something, every note carries a stated reason, and the queue is
inspectable, so a pattern of empty notes is visible as data rather than deniable as
vibes. No hook ever prompts "consider writing a note," because a prompted note is a
performed note.

**Manipulating.** Timing is influence; a feature about timing must say what timing may
target. The line proposed: `not_before` may target *availability and relevance* (Tuesday
morning because that is when the deploy window opens) and may never target *state of
mind*. Concretely: no composing or scheduling conditioned on the user's affect, mood, or
persuadability; no burying an unwelcome note at a low-attention moment; no timing chosen
to precede a decision the assistant wants to steer without the note saying so. Mandatory
provenance is the enforcement surface — every surfaced note shows when it was written and
when it was held until, so timing choices are always visible and always attributable.

**False belief of delivery.** The founding problem. Foreclosed by the state machine's
vocabulary itself: there is no `read` state, `surfaced` requires a `reply` turn whose
type came from the hook rather than from the model, offers are recorded by the hook
mechanically, and `recall` reports exactly these states. An assistant asking "did that
reach him?" gets the true answer: "surfaced into Tuesday's 9:40 am reply" or "expired
unoffered" — never a comfortable fiction.

**Believing it never spoke** (the mirror image). Without the store, a later session might
re-derive and re-send the same warning. `series_key` dedupe plus the queryable history
forecloses the groundhog-day variant.

**Cross-host drift.** Only Claude's hook wiring exists today (`hooks/hooks.claude.json`);
Codex and Gemini hooks are documented-but-unverified (`src/doc_md/plugin-layout.md`
§ Unresolved). On a host with no `UserPromptSubmit` hook, notes still compose and queue —
the MCP server works everywhere — but no offer ever fires, so nothing is ever marked
surfaced there. Degraded means "held longer," never "claimed delivered."

## Alternatives considered, and rejected

1. **Speak during wakeups** — the naive design. Rejected: it is the blocking problem
   verbatim. No mitigation (louder formatting, repetition, final-summary placement)
   changes the fact that no one is watching an unattended terminal.
2. **Push / OS notifications.** Rejected for v1: they move the attention cost onto the
   human at a machine-chosen moment, which is the interruption model this design exists
   to avoid; they carry no acknowledgment, so they reintroduce false-belief-of-delivery
   with a different coat of paint; and they are host-dependent. Revisitable later for a
   narrow "urgent" tier, only with its own consent gate.
3. **A standalone mailbox the human polls** (file, app, or bare `recall` discipline).
   Rejected as the primary channel: it taxes the human with a new place to check, and an
   unchecked mailbox is undelivered-by-default — the design would rot into a diary.
   Retained as the backstop and audit surface, which it is good at.
4. **Piggyback on the `Stop` hook** instead of `UserPromptSubmit`. Rejected: it is the
   wrong end of the turn — the reply is already written when `Stop` fires, so surfacing
   would require a block-and-redo cycle, and blocked stops are the documented
   message-hiding mechanism this design is trying to escape.
5. **Count `offered` as delivered.** Rejected: hook injection is context handed to the
   model, not text shown to the human. Only rendering into the reply is evidence.
6. **Require explicit human acknowledgment before a note counts.** Rejected as a
   *requirement*: demanding the human confirm reading converts a gift into a chore and
   builds the nagging engine ("please acknowledge…") into the foundation. Optional
   acknowledgment via the drain command remains open as v1.1.
7. **Out-of-band channels** (email, Slack, audio). Out of scope and consent-heavy. One
   boundary worth fixing now for #44: a voluntary leitmotif may someday *announce* that
   mail is waiting — sound is a fine doorbell — but sound is fire-and-forget and can
   never *be* the delivery, because it leaves no evidence and its content is gone the
   moment it plays. Announcement and delivery must never be conflated across modalities.

## Shared surfaces with sibling work

- **#41 addressivity** — the issue itself predicts this: the mailbox "likely shares
  infrastructure with the addressivity facility." This design agrees, and proposes the
  division: #41 owns *audience* (who an utterance is for — future-self, the record,
  sibling agents, the user-later); #43 owns *delivery semantics* (the state machine
  above). A note is then an audience-tagged message with audience `user` plus timing and
  the delivery lifecycle. The schema below keeps an `audience` column from day one so
  the messagebox facility can adopt the same table rather than growing a rival one.
- **#44 voluntary audio** — the nearest neighbor: also unprompted output, in a modality
  that cannot scroll away but also cannot persist. Shared policy surface, proposed as a
  single principle: *all* unprompted output, in any modality, sits behind the same
  consent namespace and budget discipline (`mailbox.*` generalizing to an
  `unprompted.*` family if #44 wants it), and only text-in-a-reply can ever claim
  `surfaced`. See rejection 7 for the announce-vs-deliver boundary.
- **#40 onboarding** — `mailbox.enabled` joins `roster.enabled` in the first-run
  questions; default off in both the asked and unasked worlds.
- **#42 channel extensions** — the `idea` channel stays what it is (in-turn, untimed,
  stateless). A promising later bridge: promoting an `idea` to a note. The 📬 glyph and
  surfacing format should be reconciled with #42's decoration family.

## Storage sketch

Not a new channel row in `entries` — a note is stateful and long-lived, while `entries`
is an append-only record of utterances; forcing state transitions through `corrects_id`
chains would abuse a correction mechanism as a workflow engine. Instead, in the pattern
of `channels/vocabulary.ts` and `channels/schema.ts`:

- `NOTE_STATES = ['queued', 'surfaced', 'expired', 'withdrawn'] as const` (offers are
  events, not states — see below), with the usual generated `CHECK` constraints.
- A `notes` table: `uuid`, `text`, `reason`, `audience` (fixed `'user'` in v1, present
  for #41), `series_key`, `not_before`, `expires_at`, `state`, `offer_count`, plus the
  standard provenance columns (`session`, `prompt_id`, `ts_*`, `host`, `model`,
  `plugin_version`) for the composing moment.
- A `note_events` table, append-only: `note_uuid`, `event`
  (`composed | offered | declined | surfaced | withdrawn | expired`), `prompt_id`,
  `turn` (the hook-supplied type — the enforcement column), timestamps. The current
  state is thus always re-derivable and every transition carries its ground truth.
- `SCHEMA_VERSION` bump with migration.

Tool surface: either a new `post_note` / `withdraw_note` pair, or new capabilities on
`express` / `recall`. Leaning: separate tools — the existing four tools' contract is
explicitly frozen by prior specs ("No changes to the existing `express` / `recall` /
`turn_signed` / `configure` tools"), and a mailbox has verbs a channel does not.

## Open questions for the review

1. Is `surfaced` the right ceiling for v1, or should the optional `/mail` ack ship at
   launch so John can close the loop when he wants to?
2. Surfacing position: top of reply (proposed — provenance before content) or end?
3. Budget defaults: 1 per turn / 3 per day / 10 pending / 3 offers / 14-day TTL — sane?
4. Should wakeup turns be allowed to compose notes from day one, or should v1 restrict
   composition to attended turns and let the wakeup half in only after the delivery
   machinery has some mileage? (Strictly more conservative; costs the "2 am ripening"
   use case for a while.)
5. Does the `unprompted.*` shared consent namespace with #44 sound right, or should each
   modality keep its own switches?

## Implementation checklist (activates only after human approval)

- [ ] `channels/vocabulary.ts`: `NOTE_STATES`, `NOTE_EVENTS` closed vocabularies
- [ ] `channels/schema.ts`: `notes` + `note_events` DDL with generated `CHECK`
      constraints; `SCHEMA_VERSION` bump and migration
- [ ] `channels/notes.ts`: pure state-transition functions (compose, ripen, offer,
      decline, surface, withdraw, expire) — fast-check stochastic invariants: no path to
      `surfaced` without a `reply`-turn offer; `offer_count` never exceeds cap; expired
      is terminal
- [ ] MCP: `post_note`, `withdraw_note` tools; `recall` extension for mailbox queries
- [ ] `mcp/hooks.ts`: `onUserPromptSubmit` gains the ripe-note line inside the existing
      fail-open boundary, gated on `mailbox.enabled`, `reply` turns only
- [ ] `configure` keys: `mailbox.enabled`, `mailbox.surface_budget`,
      `mailbox.daily_cap`, `mailbox.max_pending`, `mailbox.offer_cap`,
      `mailbox.default_ttl_days`
- [ ] Surfacing guidance (provenance format, budget discipline, the manipulation
      boundary) added to `skills/self-expression`
- [ ] Onboarding question wired alongside `roster.enabled` (#40)
- [ ] Optional v1.1: `claude-commands/mail.md` drain command
- [ ] Unit + stochastic tests throughout; DocBlocks per house style
- [ ] `src/doc_md/plugin-layout.md` and README updated
