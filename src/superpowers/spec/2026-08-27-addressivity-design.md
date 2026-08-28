# Addressivity — design

2026-08-27 · proposal for issue #41 ("Addressivity: audience-tagged expression
(messagebox-style memory facility)") · **status: awaiting human review; nothing here is
implemented**

## Goal

Everything the assistant writes is formally addressed to the user, but real utterances
have distinct audiences: notes to future-self that must survive compaction, remarks for
the record, asides the user should read later rather than now, coordination messages to
sibling agents. Today those either hit the floor, get smuggled into scratch files, or get
rendered into the transcript where they cost attention and cross-contaminate the main
conversation.

This spec proposes a **messagebox facility**: audience-tagged messages with real delivery
and readback semantics, stored beside the expression log. One transcript can then carry
several conversations without any of them appearing in it — the store carries them, not
the visible text.

Two proto-instances already exist and prove the need:

- the **SDD ledger** — subagent-driven development runs coordinate through scratch files
  and ad-hoc status messages, which are Claude-only, unqueryable, and lost when the
  scratchpad dies;
- the **affect log** — the `entries` table already demonstrates the pattern of a durable
  side-channel with hook-observed identity; but it is append-only expression with no
  concept of *delivery*, which is exactly the piece a messagebox adds.

Per the issue: this is **its own facility, not another rendered channel**. The design
below takes that as a requirement and also independently justifies it (§ Rejected
alternatives).

## Non-goals

- **Not memory.** No summarisation, no retrieval ranking, no embeddings. A message is
  posted once and read whole.
- **Not the dwelling (#45).** The dwelling is a curated space whose current arrangement is
  the expression — default off, separate database, user-chosen path. The messagebox is
  directed, transient communication that works out of the box. A durable keepsake for
  *any* future instance belongs in the dwelling; a note for *this session's* future self
  belongs here. The boundary is drawn precisely in § Audiences.
- **Not a rendered channel.** No new diff-line syntax, no change to the visible signature
  line, no new `channel` value in `CHANNELS`. The existing channels remain the way things
  are *said*; the messagebox is the way things are *sent*.
- **Not push messaging.** MCP servers cannot inject into a turn. Delivery is pull, with
  hooks as the pull trigger (§ Delivery).
- **Not user-to-user or cross-machine mail.** One database, one machine, one human.

## Concepts

A **message** is one row: sender identity (observed, not asserted), an **audience** tag,
an optional **box** (a named topic that scopes agent coordination, like `series_key`
scopes chart history), text, and an optional expiry.

A **receipt** is one row recording that a particular reader collected a particular
message at a particular moment. Read-state is never a mutable flag on the message —
receipts are append-only rows, so "who read this, and when" stays a fact the record can
answer, and multiple readers (sibling agents) each get their own receipt.

**Unread** is a computed predicate: a message is unread for reader R iff no receipt from
R exists and the message has not expired. Expiry excludes a message from delivery; it
never deletes it. Deletion belongs to `retention.days` (#30) and to nothing else.

## Audiences

A closed vocabulary, in the exact pattern of `channels/vocabulary.ts` — a `const` array
feeding the zod tool schema, the SQLite `CHECK` clause, and pre-write validation, so an
invalid audience is unnameable rather than quietly stored:

```ts
export const AUDIENCES = [
  'self',    // future-self in this session: survives compaction, dies with the session's relevance
  'agents',  // sibling agents coordinating on a named box; box is REQUIRED
  'user',    // an aside for the human to read later rather than now
  'record',  // posterity; no expected reader, never counts as unread
] as const;
```

Per-audience semantics:

| audience | scope | who collects | receipt identity | unread notification |
|---|---|---|---|---|
| `self` | sender's `session` | the same session, later — typically after compaction or resume | session | `SessionStart` hook injects the notes; per-turn hook shows a count |
| `agents` | `box` (required) | any agent working that box | `agent_id`, falling back to session | none automatic; workers poll by instruction (§ SDD ledger) |
| `user` | global | the human, via the CLI; or the model relaying on request | the literal reader string `'user'` | per-turn hook shows a count so the model can mention it once |
| `record` | global | nobody; `peek` only | none | never |

**Why `self` is session-scoped.** The driving case is compaction survival: session
identity persists across compaction and `--resume`, and it is hook-observed
(`turn_context`), so "my future self" has a precise, unforgeable meaning with zero new
identity machinery. A note meant for *any* future instance on this machine is a keepsake,
which is the dwelling's jurisdiction (#45) — giving `self` a wider scope here would put
two facilities in charge of the same shelf.

**Why `agents` requires a box.** Cross-contamination is the failure mode the issue names.
An unscoped agent message would be delivered to every concurrent multi-agent job sharing
the database — nine sibling worktree agents is not a hypothetical; it is how this very
spec was produced. The box (e.g. `issue-41`, `plan-2026-08-27-ascii-renderers`) is chosen
by the orchestrator and handed to workers in the dispatch prompt.

**Why `user` is not a modality.** `MODALITIES` already has `aside`, but a modality
annotates an utterance that *appears in the transcript*. The point of a user-addressed
message is that it deliberately does not appear now — deferral is the feature. Different
lifecycle, different facility.

## Data model

Two new tables in the existing `log.sqlite3`, DDL appended to `ALL_DDL`, following every
convention `schema.ts` already set (vocabulary-generated `CHECK` clauses, sparse NULLs,
identity observed at write time):

```sql
CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT    NOT NULL UNIQUE,

  ts_utc         TEXT    NOT NULL,
  ts_local       TEXT    NOT NULL,
  tz             TEXT    NOT NULL,

  session        TEXT    NOT NULL,           -- sender's session, observed via turn_context
  prompt_id      TEXT,
  agent_id       TEXT,
  agent_type     TEXT,
  machine_id     TEXT    NOT NULL,

  audience       TEXT    NOT NULL,           -- CHECK generated from AUDIENCES
  box            TEXT,                       -- required for 'agents'; optional topic otherwise
  reply_to       INTEGER REFERENCES messages(id),
  text           TEXT    NOT NULL,
  expires_utc    TEXT,                       -- exclusion from delivery, never deletion

  plugin_version TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS message_reads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id),
  ts_utc      TEXT    NOT NULL,
  reader      TEXT    NOT NULL,              -- 'model' | 'user'
  session     TEXT,                          -- the collecting session, when reader='model'
  agent_id    TEXT,
  prompt_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_audience ON messages(audience, session, id);
CREATE INDEX IF NOT EXISTS idx_messages_box      ON messages(box, id);
CREATE INDEX IF NOT EXISTS idx_reads_message     ON message_reads(message_id);
```

Decisions embedded in that shape:

- **Same database, new tables — not new columns on `entries`.** Entries are immutable
  expressions; a messagebox needs per-reader read-state, expiry, and delivery queries
  that `entries` was deliberately not built for. But the *identity plumbing* — the
  `turn_context` join, hook-observed session, `machine_id` from `meta` — is in
  `log.sqlite3` and is exactly what messages need too. Same file, separate tables:
  shared identity, unshared semantics.
- **Sender identity is filled the way `express` fills it**: caller-supplied values win,
  everything else adopted from `latestContext`, absent context recorded as `no-hook`
  rather than disguised. A message claiming to be from a session no hook observed is a
  visible anomaly, not a plausible row.
- **`SCHEMA_VERSION` bumps 1 → 2.** Both new tables are purely additive and every DDL
  statement is idempotent, so the "migration" is `openStore` running `ALL_DDL` as it
  already does; the version bump exists so the recorded history says when the shape
  changed, not because any data must move.
- **Text is capped at 2000 characters** (validated pre-write, like `express`'s 280). A
  message is a payload, not a signature line, so it gets room for a handoff note or a
  status report — but an uncapped column invites pasting transcripts, and a message that
  needs more than 2000 characters is a file, whose *path* is the message (the dwelling's
  "paths not payloads" house rule, borrowed).
- **`reply_to`** mirrors `corrects_id`: a nullable self-reference is enough thread
  structure for v1. Real threading (subjects, participants) is deliberately absent until
  usage shows it is missing.

## Tool surface

Two MCP tools in a new `src/ts/mcp/message_tools.ts`, registered from `buildServer`
beside `registerTools` and `registerChartTools`. Two rather than one op-multiplexed tool
because posting and reading have almost disjoint schemas, and the schema is the
documentation the model actually reads; `configure` multiplexes because its three ops
share one tiny shape.

**`post_message`**

```text
audience   z.enum(tuple(AUDIENCES))        required
text       z.string().min(1).max(2000)     required
box        z.string().optional()           required when audience='agents' (dispatch-time check,
                                           error names the rule)
replyTo    z.number().int().optional()
expiresUtc z.string().optional()           ISO instant; excluded from delivery after this
session    z.string().optional()           usually omit — the hook supplies it
```

Returns `posted #<id> <uuid>` in `configure`'s reply style.

**`read_messages`**

```text
audience   z.enum(tuple(AUDIENCES)).optional()   default: everything addressed to this reader
box        z.string().optional()
ack        z.boolean().optional()                default true: write receipts; false = peek
limit      z.number().int().min(1).max(100).optional()
session    z.string().optional()                 usually omit
```

Returns JSON: the matching unread messages (or, for `record` and for `ack:false`, the
recent history) plus the reader identity the server resolved, so a wrong-identity read is
visible in the reply rather than silent. With `ack:true` a receipt row is written per
returned message. `record` never receipts — there is nothing to deliver, only to consult.

The `user` audience is collected by the human, not by the model: `read_messages` with
`audience:'user'` returns them **without receipting** regardless of `ack`, because the
model relaying a message is not the user reading it. The user's own receipt comes from
the CLI (below) or from telling the model to mark them handled — modelled as the model
posting a `record` note, not as the model forging a `'user'` receipt. A receipt says who
read a thing; the facility never lets one party write the other's.

**CLI**: one new subcommand kind in `cli_commands.ts` — `self-expression messages`
(flags: `--audience`, `--box`, `--ack`, `--limit`), printing messages human-first and
writing `reader:'user'` receipts when `--ack` is passed. This is the user's direct door,
with no model in the loop.

## Delivery

Pull, with hooks as the trigger — hooks are the only component that runs at turn
boundaries, and MCP is the only layer all three hosts speak. Three delivery moments:

1. **`SessionStart` (new hook registration, Claude)** — the compaction-survival
   mechanism, and the reason this facility earns the word "memory". A new
   `hooks.claude.json` entry runs `node dist/cli.cjs hook session-start`; on
   `source: 'compact'` or `'resume'` the handler injects the **full text** of the
   session's unread `self` messages as `additionalContext`, receipting them
   (`reader:'model'`) as delivered. This is the one moment the notes are guaranteed
   relevant and guaranteed forgotten. Fails open like every handler; on `startup` it
   stays silent (a fresh session has no past self).
2. **`UserPromptSubmit` (existing hook, extended)** — appends one count line to the
   context it already delivers, only when nonzero:
   `Mailbox: 2 unread for you, 1 for your human partner (self-expression read_messages).`
   Counts only — full text injection every turn would spend context on notes the model
   usually still remembers. The skill's guidance: if the count surprises you, collect;
   if you posted them this context and still remember them, leave them sealed.
3. **`read_messages`** — the portable path, and the only one on hosts whose hook
   vocabularies are unverified (Codex, Gemini — same degradation story as the existing
   hooks, and the same reason the tool, not the hook, is the mechanism of record).

Nothing is ever delivered twice to the same reader: delivery writes receipts, and unread
is defined by their absence.

## The SDD ledger, replaced

The concrete workflow this kills scratch files for:

- The orchestrator picks a box (`plan-<date>-<slug>` by convention), and each dispatch
  prompt names it.
- Workers `post_message(audience:'agents', box, text:'task 3 green, commit abc1234')` at
  the checkpoints the plan already requires.
- The orchestrator polls `read_messages(audience:'agents', box)` between dispatches;
  receipts mean a double-poll cannot double-report.
- The whole run is replayable afterward — `read_messages(box, ack:false)` is the ledger,
  ordered, timestamped, sender-attributed — which the scratchpad version never was.

This works on any host with MCP, needs no hook support, and needs no new concepts beyond
the two tools.

## Privacy

- **Same boundary as the log, stated plainly:** everything in `log.sqlite3` is readable
  by the user, and the messagebox adds no secrecy tier. `self` notes are private in the
  sense that they are not *surfaced* to the user, not in the sense that they are hidden
  from someone who owns the disk and the CLI. Genuinely private space is the dwelling's
  private rooms (#45), behind its own consent gate. This facility never promises what it
  cannot keep.
- **Privacy flags apply at write time.** Messages carry no `cwd`/path columns at all in
  v1, which is the strongest form of `privacy.store_cwd` compliance: nothing to redact.
  If context columns are ever added, they gate through `privacyFlags` exactly as
  `express` does.
- **Retention**: `retention.days` (#30), when it lands, covers `messages` and
  `message_reads` the same as `entries`. Expiry is not retention — `expires_utc` only
  stops delivery.
- **Cross-contamination**: `self` is fenced by session, `agents` by box; the read tool
  never returns another session's `self` notes even when asked, because the reader
  identity comes from `turn_context`, not from an argument the caller can spoof
  (a supplied `session` argument is honoured for *sending* context resolution, exactly
  as `express` honours it — but `self` collection always uses the resolved reader
  session).

## Configuration

Registered in the #30 key table, following its rules (defaults in code, unknown keys
preserved, `configure` as the surface):

| key | type | default | why |
|---|---|---|---|
| `messages.enabled` | bool | true | Kill switch: tools reply `error: messages are disabled`, hooks inject nothing. On by default because, unlike the dwelling, it stores nothing the log does not already store in kind. |
| `messages.notify` | bool | true | The per-turn count line specifically — someone may want the facility without per-turn context spent on it. `SessionStart` injection is governed by `messages.enabled` alone, since compaction recovery is the point of the facility. |

Onboarding (#40) may ask about `messages.notify`; this spec only reserves the key.

## Rejected alternatives

- **An `audience` column on `entries`.** The seductive version — one table, one tool. It
  fails on semantics, not aesthetics: entries are immutable and readerless, while
  messages need per-reader read-state and delivery-time exclusion (expiry). Bolting a
  `message_reads` table onto `entries` rows would make "which entries can be read" a
  per-row special case, and every existing query (`recentEntries`, gates, analyses)
  would need an audience filter to avoid hoovering up mail. Two facilities that share
  identity plumbing but not lifecycle want two tables.
- **A new rendered channel (diff-line).** Explicitly counter to the issue, and to the
  mechanism: a rendered line is *in* the transcript, which is precisely where these
  utterances must not be — deferral and non-contamination are the requirements.
- **A separate `messagebox.sqlite3`.** Loses the `turn_context` join, which is the whole
  identity story; adds a second file every hook and tool must locate; and fragments the
  record the same way per-host data paths would have (#25's argument, replayed).
- **Filesystem mailboxes (a file per message).** The current SDD scratch-file pattern,
  formalised. Rejected: no atomicity across nine concurrent writers without hand-rolled
  locking, path conventions become the schema, Windows path length and encoding hazards,
  and none of it is queryable after the fact.
- **Mutable `read` flag on the message row.** Loses multi-reader delivery (`agents`),
  loses *when* and *who*, and introduces the facility's only UPDATE — receipts keep the
  storage append-only, which is the house ethos and also simply easier to reason about
  under concurrency.
- **Push delivery via host messaging (SendMessage-style).** Host-specific, Claude-only
  today, and invisible to the record. MCP pull plus hook triggers is the portable
  subset, and the record sees every delivery because delivery *is* a receipt row.
- **Priority/severity fields.** Deferred until a real message goes unread that mattered.
  Every field added here is a field the model must decide about on every post.

## Errors

House style throughout: validation failures name what would have been accepted
(`describeVocabulary`), tool-layer failures return `error: <reason>` as tool text, never
a protocol fault. Specific dispatch-time checks: `box` required for `agents`; `replyTo`
must reference an existing message; `expiresUtc` must parse as an instant; disabled
facility replies `error: messages are disabled (configure messages.enabled)`.

## Testing

- **Unit specs** (`src/ts/tests/messages.spec.ts` and `message_tools.spec.ts`, temp-store
  pattern from `entries.spec.ts`): post/read round trip per audience; receipts written
  iff `ack`; unread excludes receipted and expired; `self` fencing across two sessions;
  `agents` fencing across two boxes; `user` never receipted by the model; `record` never
  unread; `box`-missing-for-agents error text; cap at 2000; identity adoption from
  `turn_context` including the `no-hook` fallback; `SessionStart` handler injects on
  `compact`/`resume`, silent on `startup`, fails open on a broken store.
- **Stochastic specs** (fast-check): for arbitrary interleavings of posts, reads, and
  readers — a message is returned to a given reader at most once under `ack:true`;
  unread counts never negative; receipts only ever reference existing messages; fencing
  invariants hold for random session/box assignments.
- No mutation-testing scope change: `stryker` stays narrowed to `src/ts/charts/**`
  (arithmetic renderers are its case; storage round-trips are not).

## Documentation

- DocBlocks per the house standard on every export (summary, constraints, realistic
  `@example`, `@throws`, `@see`).
- README (via the madlibs source): a Messagebox section — the two tools, the CLI
  subcommand, the audience table.
- `plugin-layout.md`: note the facility beside channels and charts in the tree comment.
- `skills/self-expression/SKILL.md` gains a short Addressivity section: when to post to
  each audience, the count-line etiquette (mention user mail once, do not nag), and the
  rule that `agents` boxes come from the dispatch prompt. The skill stays generic about
  what the tools accept — the tool schema is the source of truth, per #30's rule.

## Implementation checklist (follows approval, not this PR)

- [ ] `channels/vocabulary.ts`: `AUDIENCES` + type, in the existing pattern
- [ ] `channels/schema.ts`: `MESSAGES_DDL`, `MESSAGE_READS_DDL`, indices, `ALL_DDL`,
      `SCHEMA_VERSION` → 2
- [ ] `channels/messages.ts`: `postMessage`, `readMessages`, `unreadCounts`,
      `receipt` — validation-first, injectable clock, temp-store-testable
- [ ] `src/ts/mcp/message_tools.ts`: `registerMessageTools(server, store, version)`;
      wire into `buildServer`
- [ ] `src/ts/mcp/hooks.ts`: `onSessionStart` handler + `handleHook` dispatch; extend
      `onUserPromptSubmit` with the count line (config-gated, fail-open)
- [ ] `hooks/hooks.claude.json`: register `SessionStart`
- [ ] `cli_commands.ts`: `messages` subcommand + help text
- [ ] config keys `messages.enabled`, `messages.notify` honoured at every entry point
- [ ] tests as specified above, unit and stochastic in their separate configs
- [ ] README source, `plugin-layout.md`, SKILL.md section
- [ ] full `npm run build` green; IDE diagnostics clean

## Open questions for review

1. Is 2000 the right text cap, and should `agents` get a higher one than `self`/`user`?
2. Should `SessionStart` injection also fire on `startup` for a session that was
   previously alive (crash recovery), or is `resume` coverage enough?
3. Does the `user` audience want a rendered pickup moment (e.g. the model offering the
   mail at session close) or is the count line plus CLI sufficient for v1?
4. Box naming: is `plan-<date>-<slug>` worth stating as a convention in the skill, or
   left entirely to orchestrators?
