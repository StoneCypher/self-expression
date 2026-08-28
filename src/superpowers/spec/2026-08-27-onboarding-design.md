# Onboarding — design

2026-08-27 · refs issue #40 ("Onboarding: ask the user their preferences at first run")

This is a proposal for human review, not an implemented decision. It composes the
already-decided config keys from #30, #42, #45, and the party-roster skill into a
first-run questionnaire mechanism; it deliberately invents no keys of its own beyond
the one ledger key that records questionnaire progress.

## Goal

Several features of this plugin are durably toggleable, and several of them default
off precisely because they are matters of taste (the roster), size (forecasts), or
consent (the dwelling). Leaving those toggles to be discovered by accident means most
users never learn they exist. A first-run onboarding flow asks once, writes the
answers through the existing `configure` machinery so they hold across sessions *and
across hosts*, and then gets out of the way permanently.

The questionnaire as of the final 2026-08-27 verdicts (#40 comments, #42 comments):

| id | asks about | config key(s) | default | key owner |
|---|---|---|---|---|
| `roster` | party-roster flavor when dispatching subagents | `roster.enabled` | off | party-roster skill / #40 |
| `forecast` | end-of-turn forecasts (physically large; divisive) | `forecast.enabled` | **on** | #42 |
| `revision` | visible revision — the one informative strikethrough seam | `revision.enabled` | off | #42 |
| `salience` | sentence-initial ⭑ on the load-bearing sentence | `salience.enabled` | **on** | #42 |
| `taste` | the `# 🎨 taste:` observation line | `channels.enabled` (taste is a channel) | **on** | #42, #30 |
| `gifts` | the gift register | `gifts.enabled` | off | #42 |
| `dwelling` | the keepsake dwelling; requires a storage directory | `dwelling.enabled` + `dwelling.path` | off, **no default path** | #45 |
| `channels` | trimming the expression-channel set | `channels.enabled` | all | #30 |

Every key above except the ledger key (below) is owned by another spec; this document
inherits their names and defaults and must be corrected if those specs change.

## Non-goals

- **Implementing the features being toggled.** Forecasts, visible revision, salience,
  the gift register, and the dwelling each have their own issue (#42, #45). Onboarding
  only records the user's preference; a key set for a feature that has not shipped yet
  is simply an override waiting for its reader.
- **Host-native settings UI.** No Claude `userConfig`, no Gemini `settings` — rejected
  for onboarding by the same argument #30 used to reject them for configuration
  generally: they exist on one host each, and a choice made there is invisible to the
  other hosts.
- **A CLI wizard.** See Alternatives.
- **Nagging.** Onboarding is offered, at most once per session, and never blocks
  anything. A user who ignores it forever gets code defaults forever, which is a
  fully-working state.

## Where answers persist

In the `config` table, written through the same `writeConfig` path the `configure`
tool uses — #30's two-layer precedence (`config` table row → code default) applies
unchanged. Onboarding adds exactly one key of its own:

- **`onboarding.answered`** — a comma-separated list of question ids that have been
  *resolved*: answered, or explicitly skipped. Same list-in-a-string idiom as
  `channels.enabled`. Unknown ids in the list are preserved, never dropped, per #30's
  unknown-keys rule — a newer plugin version's question ids must survive a write by an
  older version.

Two subtleties, both consequences of #30's "defaults live in code, not in seeded
rows":

1. **Accepting the defaults writes no config rows.** The fast path ("the defaults are
   fine") marks every pending question answered in the ledger and writes nothing else.
   A later release changing a default then reaches this user, which is exactly what
   accepting defaults should mean.
2. **An explicit answer writes its row even when the answer equals the current
   default.** "Yes, I want forecasts" is an override by intent: the user chose the
   value, and a later default flip must not silently un-choose it. #30's rule bars
   *seeding* — rows nobody asked for — not the recording of explicit choices.

## How "first run" is detected

First run is a property of the **database**, not the host, machine, or session. The
store is shared across hosts by design (`SELF_EXPRESSION_HOME`, #30), so onboarding
happens once total — a user who answered under Claude Code is not re-interrogated
under Gemini. That is the point of the exercise.

A question is **pending** when all of the following hold:

- its id is not in `onboarding.answered`, and
- none of its config keys has an explicit row (a user who already ran
  `configure set roster.enabled true` by hand has answered that question; asking again
  would be noise).

Fresh database → empty ledger, no rows → everything pending → this is a first run.

There is deliberately **no completion boolean**. Issue #40's own history is the
argument: the questionnaire grew three times in a single afternoon (forecast and
revision, then the dwelling, then salience/taste/gifts). Under a boolean, every
addition either re-runs the whole interview or reaches nobody who already onboarded.
Under the per-question ledger, an upgrade that ships a new question produces exactly
one pending item, and the next offer asks only that.

## Mechanism

### A question registry, in code

`src/ts/channels/onboarding.ts` exports a `QUESTIONS` registry: an ordered
`readonly` array of `{ id, prompt, keys, kind, defaultAnswer }`, in the table order
above (cheap yes/nos first, the two structural questions — dwelling and channel
trimming — last). `kind` distinguishes the three answer shapes:

- `boolean` — everything except the two below; `answer` writes `'true'`/`'false'` to
  the single key.
- `path-gated boolean` — the dwelling. An enabling answer **must** carry a `path`
  argument; without one the answer is refused with a message restating #45's rule (no
  default path; the feature refuses to activate without a user-chosen directory).
  `path` is stored verbatim in `dwelling.path`; existence and writability are the
  dwelling implementation's concern (#45), not onboarding's.
- `channel-list` — channel trimming; `answer` writes `channels.enabled`. The valid
  names come from `CHANNELS` in `channels/vocabulary.ts`, and the reply must state the
  startup caveat: the `express` channel enum is baked at server start (#30's
  neither-logged-nor-offered mechanism), so a trim takes full effect next session.

Pure helpers beside it: `pendingQuestions(store)` implementing the detection rule
above, and `resolveQuestion(store, id)` appending to the ledger idempotently.

The registry is the single source of truth. The skill never enumerates the
questions, for the same reason skills never enumerate channels: static markdown
cannot track registry growth or answered state.

### One MCP tool: `onboard`

Registered in `src/ts/mcp/tools.ts` alongside `configure`, on the same server (#10's
direction: the MCP layer is the one surface all three hosts speak identically). Ops:

| op | effect |
|---|---|
| `status` | Read-only. Returns JSON: the pending questions (id, prompt, kind, default, keys), the ledger, and `complete: boolean`. This is also the implicit "defer" — a session that only ever calls `status` writes nothing, and the offer recurs next session. |
| `answer` | `{ id, value, path? }`. Validates against the registry (`z.enum` over question ids, so a hallucinated question cannot validate — the malformed-payloads-get-rejected principle from #10), writes the config key(s), appends the id to the ledger. Refuses a dwelling enable without `path`. |
| `skip` | Marks **all currently pending** questions resolved in the ledger, writes no config rows. The reply states that code defaults apply and that `configure` (or "re-run onboarding") can change any of it later. |
| `reset` | Clears `onboarding.answered` only — config values are untouched — so the questionnaire becomes pending again. This is "re-run onboarding". Because answered-by-hand keys still count as resolved, a reset re-asks only questions the user never explicitly configured; a user wanting a truly blank slate clears the keys through `configure`. |

`answer` accepting one question per call, rather than a batch payload, is deliberate:
each answer is one row-write plus one ledger append, trivially validated, and the
model is conducting a conversation anyway — there is no moment where it holds eight
answers and no tool budget.

### How the model learns onboarding is pending

Three cooperating surfaces, none host-specific:

1. **Server `instructions`.** `buildServer` computes `pendingQuestions(store)` at
   startup and, when non-empty, passes an `instructions` string to the `McpServer`
   constructor: "Onboarding pending (N questions). At a natural pause, offer the
   questionnaire; `onboard {op:'status'}` lists it. Never interrupt the user's task
   for this." The MCP initialize handshake delivers this on every host.
2. **The tool's own presence.** `onboard` is always registered (a tool that appears
   and disappears between sessions would confuse permission caches); when nothing is
   pending, `status` says so and the skill says to do nothing further.
3. **Skill text.** `skills/self-expression/SKILL.md` gains a short Onboarding section
   carrying the etiquette (below), written generically — "offer whatever `status`
   reports" — so it never goes stale against the registry.

Hooks are deliberately **not** part of the detection path: they are the least
portable layer (Claude-only today, per plugin-layout.md), and onboarding must reach
Codex and Gemini users, who are precisely the users host-native prompting misses.

### Etiquette (normative for the skill text)

- **Never hijack the first turn.** The user opened the session to do something; do
  that first. Offer at the first natural pause — end of the first completed task, or
  immediately when the session opens with smalltalk rather than work.
- **One short offer.** A sentence naming the count and the fast path: "This plugin
  has N preference questions (~1 minute) — or say 'defaults' and I'll never ask
  again." No table dumps uninvited.
- **The fast path is one word.** "Defaults" → `onboard {op:'skip'}` → done forever.
- **Asked and ignored is answered "not now".** If the user talks past the offer, drop
  it for the session; `status`-only sessions write nothing, so it recurs next session
  — but at most one offer per session, ever.
- **Host-flavored presentation is welcome, host-agnostic core is required.** Under
  Claude Code the model may use `AskUserQuestion` for the yes/nos; under Codex and
  Gemini it asks conversationally. Either way the answers land via `onboard`, so the
  record is identical.
- **The dwelling question carries its consent shape.** Enabling means asking the user
  for a directory — drive choice and disk space are the user's call (#45) — and an
  enthusiastic "yes" without a path is answered with the follow-up question, not a
  guessed path.

## Alternatives rejected

**Claude Code `userConfig` prompting.** The host prompts natively and stores
typed values — genuinely nicer, and rejected here for exactly #30's reason: it exists
only in Claude Code, and its answers land in host config where the other hosts (and
the plugin's own store-reading code paths) cannot see them.

**A CLI wizard (`npx self-expression onboard`).** Works everywhere in principle;
run by nobody in practice. The plugin's entire surface is conversational, its users
meet it inside a chat session, and an out-of-band terminal step is a step that does
not happen. If one is ever wanted (CI provisioning, dotfile replication), it can wrap
the same registry later; it is not the mechanism.

**A single `onboarding.completed` boolean.** Cannot absorb questionnaire growth,
and the questionnaire demonstrably grows — three expansions on the day the issue was
filed. A boolean forces a choice between re-interviewing everyone and reaching no one.

**Seeding every default as a config row at completion.** Superficially tidy — the
table then documents the whole state — and a direct violation of #30's
defaults-live-in-code rule: a later change to a default would never reach any
onboarded install. This is the classic version of the bug and it stays rejected.

**A blocking gate (refuse work, or refuse the stop, until onboarded).** Coercive,
hook-dependent (hence Claude-only), and against the plugin's own ethos — the layout
doc's "the obligation is safe exactly to the degree that silence is expressible"
applies with extra force to a questionnaire. Defaults are a fully-working state;
onboarding earns attention or waits.

**A separate `onboarding` table.** The config table is already the settings surface
with defined precedence and an unknown-keys preservation rule; a second store means a
second precedence question and a second migration surface for zero benefit. One
string ledger key suffices.

**Enumerating the questionnaire in skill markdown.** The same trap as skills
enumerating channels (#30): static text cannot know what is pending, what was
answered, or what a newer server added. The tool is the source of truth; the skill
carries only etiquette.

**Asking on the literal first tool call.** Maximally prompt, maximally rude: it
front-runs whatever the user actually wanted. "First run" governs *whether* the offer
exists, the etiquette governs *when* it is voiced.

## Dependencies

- **#30 (configuration surface)** — the `config` table, `configure` tool,
  `channels.enabled` semantics, defaults-in-code, unknown-key preservation. All
  already on `main` (`src/ts/mcp/tools.ts`, `src/ts/channels/store.ts`); this design
  adds `onboarding.answered` to its key namespace and follows its rules.
- **#42 (channel extensions)** — owns `forecast.enabled`, `revision.enabled`,
  `salience.enabled`, `gifts.enabled`, and the decision that taste is a channel.
  Onboarding asks about them whether or not they have shipped; if #42's spec renames a
  key, the registry entry changes with it.
- **#45 (the dwelling)** — owns `dwelling.enabled`, `dwelling.path`, and the
  no-default-path refusal rule that the `path-gated boolean` kind encodes.
- **#10 (MCP-ification)** — `onboard` follows its direction: one typed tool call,
  enum-validated arguments, no scratch files, portable across hosts.
- **party-roster skill** — owns `roster.enabled` and already documents manual
  toggling; onboarding is its discovery path.

## Implementation checklist (follows approval)

- [ ] `src/ts/channels/onboarding.ts` — `QUESTIONS` registry, `ANSWERED_KEY`,
      `pendingQuestions`, `resolveQuestion`; DocBlocks with `@example`/`@throws`/`@see`
      per house rules.
- [ ] `src/ts/tests/onboarding.spec.ts` — registry integrity (ids unique, keys named
      by their owning specs, dwelling is path-gated), pending computation against
      fresh/partial/hand-configured stores, ledger idempotence and unknown-id
      preservation.
- [ ] `src/ts/tests/onboarding.stoch.ts` — fast-check: any interleaving of
      answer/skip/reset leaves the ledger a subset of known-plus-preserved ids and
      never drops a config row it did not own.
- [ ] `src/ts/mcp/tools.ts` — register `onboard` (ops per this spec); exercise
      through `buildServer` against a temporary store, in the existing test style.
- [ ] `src/ts/mcp/server.ts` — conditional `instructions` string in `buildServer`.
- [ ] `skills/self-expression/SKILL.md` — Onboarding section: the etiquette, written
      registry-agnostically.
- [ ] `README` source — user-facing paragraph: what gets asked, "defaults" fast path,
      "re-run onboarding", and that answers hold across hosts.
- [ ] `src/doc_md/plugin-layout.md` — move onboarding from open questions to
      decisions if it is listed; note the instructions-string mechanism.
