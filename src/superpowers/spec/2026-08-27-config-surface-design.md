# Configuration surface — design

2026-08-27 · for issue #30 ("Configuration surface: keys, precedence, and the two config
layers"). This is a proposal awaiting human review; the implementation that follows
approval is what closes the issue.

## Goal

Finish the configuration surface the issue describes: a canonical registry of the keys
that exist, typed and validated writes through the `configure` tool, defined semantics
for the keys nothing consumes yet (`retention.days`, `format.version`, `time.hook`,
`gate.checklist`), and an explicit answer to each of the issue's open questions.

The storage layer is settled by #25 and already shipped. This document therefore begins
by inventorying what is already on `main`, so review effort lands only on what is
genuinely being decided.

## Already on main — settled, not re-decided here

The issue's structural decisions are implemented and this spec treats them as fixed:

- **The `config` table, overrides only, defaults in code.** `CONFIG_DDL` in
  `src/ts/channels/schema.ts`; a zero-row table is a valid, fully-working state.
- **`readConfig` / `writeConfig` / `allConfig`** in `src/ts/channels/store.ts`.
  Unknown keys are preserved, never filtered — `allConfig` returns them and nothing
  ever rewrites the whole table, so the downgrade/two-machines scenario cannot destroy
  a newer version's settings.
- **Bootstrap via `SELF_EXPRESSION_HOME`** in `src/ts/channels/paths.ts`, defaulting to
  `~/.self-expression`. Precedence is two layers, exactly as the issue collapsed it:
  the environment variable locates the database and does nothing else; every other
  choice is `config` row, else code default.
- **`channels.enabled` narrows the tool schema at startup.** `enabledChannels` in
  `src/ts/mcp/tools.ts` resolves the active set once and bakes it into the `express`
  tool's `channel` enum, so a disabled channel cannot even be named. The skill
  describes channels generically; the tool schema is the source of truth.
- **Privacy keys redact at write time.** `privacyFlags` in
  `src/ts/channels/privacy.ts`, consumed by both the `UserPromptSubmit` hook and the
  `express` tool, so a suppressed field is never captured — not captured-then-hidden.
- **`gate.signature` disables the Stop gate.** `onStop` in `src/ts/mcp/hooks.ts`
  returns allow when the key is exactly `'false'`.
- **A `configure` MCP tool exists** with `get` / `set` / `list` — but `set` accepts any
  key and any string, unvalidated. That gap is most of what this spec closes.

## What this spec decides

Nine decisions, numbered for review. Each names its rejected alternatives.

### D1 — The key registry is code, in one module

New module `src/ts/channels/config.ts` exporting a `CONFIG_KEYS` registry: for each
key, its name, kind (`bool` | `int` | `list` | `string`), code default, one-line
description, and a validator that either canonicalizes a proposed value or explains
what would have been accepted. This is the same pattern `channels/vocabulary.ts`
already uses for the same reason: the registry is needed at runtime in places types
cannot reach — the `configure` tool's rejection messages and the effective-config
listing.

The registry at introduction:

| key                        | kind   | default            | consumed by                            |
| -------------------------- | ------ | ------------------ | -------------------------------------- |
| `channels.enabled`         | list   | all channels       | tool-schema narrowing (shipped)        |
| `gate.signature`           | bool   | `true`             | Stop gate (shipped)                    |
| `gate.checklist`           | bool   | `true`             | reserved — see D8                      |
| `retention.days`           | int    | `0` (never prune)  | startup pruning (new, D6)              |
| `privacy.store_cwd`        | bool   | `true`             | hook + `express` redaction (shipped)   |
| `privacy.store_prompt_len` | bool   | `true`             | hook + `express` redaction (shipped)   |
| `format.version`           | string | `FORMAT_VERSION`   | row stamping (new, D7)                 |
| `time.hook`                | bool   | `true`             | clock injection (new, D9)              |

Defaults live in the registry as code, never as seeded rows — unchanged from #25.

Rejected: a JSON/manifest registry (would need loading, validation of the validator,
and cannot carry a canonicalization function); per-consumer scattered defaults with no
registry (the current state — it makes "what can I even set?" unanswerable by the tool,
and leaves `set` unable to validate).

### D2 — `configure set` validates known keys and stores canonical text

For a key in the registry, `set` runs the validator. An invalid value is rejected with
a reply naming the key's kind and what would have been accepted (the
`describeVocabulary` style already used for entry columns) and **nothing is written**.
A valid value is stored in canonical text form:

- bool: exactly `true` or `false`. Input is accepted case-insensitively and
  canonicalized to lowercase; anything else (`yes`, `1`, `off`) is rejected, not
  guessed at. Canonicalizing at write is what makes the read-side "only exact
  `'false'` suppresses" privacy rule safe rather than fragile.
- int: decimal digits only, within the key's range (`retention.days`: 0–3650).
  Rejected values name the range.
- list (`channels.enabled`): comma-separated channel names; each element must be a
  known channel and the list must be non-empty. Stored as trimmed names joined with
  `,`. Unknown names reject the whole write, naming the valid channels — a typo must
  fail loudly at set time, not silently disable half the plugin at read time.
- string (`format.version`): non-empty, at most 64 characters.

Readers stay tolerant (D5); writers are strict. The write path is where "set once and
quietly wrong for months" is prevented, which the issue names as the config table's
characteristic failure.

Rejected: validating on read instead (detects, does not prevent — the exact error
class the schema work already refused); accepting truthy synonyms (every synonym is a
second spelling that some future reader must also know about).

### D3 — Unknown keys: `set` accepts them, with a stated warning

A `set` on a key the registry does not contain is **stored as given**, and the reply
says so: stored, but unknown to this version — check the spelling, or ignore this if a
newer version wrote it. Storage preservation for unknown keys is already the store's
rule; this decision extends it to the write surface.

This is the deliberate middle of three options:

- Hard-reject unknown keys — rejected. It breaks the scenario the preservation rule
  exists for: a newer skill or newer plugin version on another machine legitimately
  writing a key this server does not know. It would also mean every key addition is a
  breaking change against older servers.
- Accept silently — rejected. A typo (`gate.signture`) would then sit inert for
  months, which is the failure D2 exists to prevent.
- Accept with a warning — chosen. The typo surfaces in the tool reply at the moment of
  writing, while cross-version writes still work.

### D4 — Two new ops: `unset`, and `list` shows effective config

`configure` gains `unset`, which deletes the override row so the code default applies
again — including a future changed default. Without it, a user who once set a value can
never return to tracking the default; they can only pin the current one by hand.
`unset` on a key with no override succeeds as a no-op; `unset` on an unknown key
deletes any row present (it may have been written by a newer version the user is
walking back).

`list` changes from dumping override rows to reporting **effective configuration**:
every registry key with its effective value and source (`override` or `default`), plus
any unknown override rows, labeled as unknown. The current overrides-only listing
cannot answer the first question a user has — "what is my configuration?" — when the
answer is mostly defaults.

Rejected: a separate `defaults` op (two calls to answer one question); making `get`
return structured JSON (its one-value string reply is fine; `list` is where the full
picture belongs).

### D5 — Readers never throw; an invalid stored value behaves as unset

A hand-edited database, a downgrade, or a pre-validation row must not wedge the server
or the gates. Every consumer reads through the registry's tolerant accessor: a value
that fails validation is treated as absent, so the code default applies. This is
defense in depth behind D2, not an alternative to it — `enabledChannels` already works
this way (an all-invalid list falls back to all channels rather than disabling the
plugin), and that behavior is kept.

One deliberate asymmetry is preserved: the privacy keys suppress only on the exact
string `'false'`, so an ambiguous value records rather than silently redacting. A
privacy switch takes effect only when unambiguously set; that rule already exists in
`privacyFlags` and is unchanged.

### D6 — `retention.days` prunes; it does not archive

Answering the issue's open question 1: **prune.** At server startup, after the store
opens, rows in `entries` and `turn_context` whose `ts_utc` is older than the horizon
(now minus `retention.days` days) are deleted. `0` — the default — disables pruning
entirely. `meta` and `config` are never touched by retention.

Why startup: the cost lands once per server process rather than on the write path, and
a horizon measured in days does not need better resolution than "each session start".
Why both tables: `turn_context` carries the same path-shaped context the privacy keys
guard, so a horizon that trimmed `entries` but kept context rows forever would be a
privacy hole shaped exactly like the one write-time redaction closes.

Rejected: archive — an archive is a second copy of precisely the data the user asked
to have a horizon on. For the retention motivations that are about privacy, archiving
is the option that quietly records anyway; for the ones that are about size, the user
who wants a backup can copy `log.sqlite3` themselves before the horizon passes, which
is strictly more flexible than any archive format this plugin could invent. Rejected:
prune-on-write (hot-path cost, and interleaves deletion with the gates' reads).
Rejected: a `retention.archive` boolean deferring the choice (an option that exists is
an option that must be maintained; nothing motivates it yet).

### D7 — `format.version` is a declarative pin, stamped onto rows

The `entries` schema already has a per-row `format_version` column and `recordEntry`
already accepts it — but nothing passes it, so it is always NULL. This spec introduces
a code constant `FORMAT_VERSION` (initially `'1'`) in `channels/config.ts`, and the
`express` handler stamps every row with the configured `format.version` override, else
the constant.

Pinning is **declarative, not behavioral**: the value marks which recording convention
a row was written under, so a mid-study upgrade is visible in the data and an analysis
can partition on it. The server does not emulate older conventions when pinned to an
older value.

Rejected: behavioral pinning — an unbounded compatibility surface (every future
convention change would need a maintained emulation path) for a plugin whose format
changes are expected to be additive; and a pinned emulation that drifted from the real
old behavior would be worse than the honest label. Rejected: leaving the column NULL
(the column exists precisely so a future reader can tell which convention wrote a row;
1,380 rows of the previous log cannot answer that question, which is why the column
was added).

### D8 — `gate.checklist` is registered now, consumed when the checklist gate lands

There is no checklist gate on `main`; only the signature Stop gate exists. The key is
registered and validated now so its name, type, and default are settled before any
gate reads it — no migration when the gate arrives, and no second bikeshed. The future
gate must read it exactly as `onStop` reads `gate.signature`: exact `'false'`
disables, anything else enforces, failing open on error. Building the checklist gate
itself is out of scope here and belongs to whatever issue specifies it.

Rejected: omitting the key until the gate exists — then two versions would disagree
about whether the key is "unknown" (D3 warning) across the gate's introduction, for no
benefit.

### D9 — `time.hook` suppresses the clock sentence, and only that

When `time.hook` is exactly `'false'`, `onUserPromptSubmit` omits the
`describeMoment` clock sentence from `additionalContext`. Two things deliberately do
**not** change:

- **Context recording is unaffected.** The `turn_context` write is how session
  identity, effort, and permission mode reach the record at all; it is observational,
  not presentational, and the issue's rationale for the key ("the ambient-time
  injection is presentational") does not cover it.
- **The open-signature reminder still goes out**, reworded for the clockless case —
  the shipped text says "using the timestamp above", which must not dangle when no
  timestamp was injected. The reminder belongs to enforcement (the `gate.*` family's
  concern), not to time injection; a user who wants prompting off is choosing an
  enforcement posture, not a presentation one.

Rejected: suppressing the whole `additionalContext` (couples two unrelated choices
into one key); a separate `time.reminder` key (the reminder is enforcement, and
enforcement keys are `gate.*` — if prompting ever becomes optional it should be
decided there).

## Open question 2 — no slash command, for now

The tool is the mechanism, exactly as the issue argues: only Claude and Gemini have
commands, their formats differ, and a wrapper adds a per-host surface to a design
whose point is having none. "Configure through conversation" already works on every
host — the model calls `configure` on the user's behalf. A convenience command can be
added later without touching anything this spec builds, because it would be a pure
wrapper over the tool. Recommendation: open it as a small follow-on issue if demand
appears, rather than building it speculatively.

## Non-goals

- The checklist gate itself (D8 reserves its key only).
- Any archive, export, or backup mechanism (rejected in D6).
- Host-declared config (`userConfig`, Gemini `settings`) — rejected in the issue
  itself; nothing here reopens it.
- Config UI of any kind beyond the tool.
- Schema changes. Every decision above works against `SCHEMA_VERSION = 1` as shipped.

## Migration

None required, and that is a property worth stating rather than an accident:

- Defaults were never seeded, so no rows need rewriting when the registry arrives.
- `writeConfig` has always stringified to the canonical forms D2 mandates
  (`'true'` / `'false'`, decimal), so existing override rows already validate.
- A row that predates validation and fails it is handled by D5 — treated as unset,
  code default applies — rather than by a cleanup pass.
- Downgrade safety: an older server sees a newer server's keys as unknown overrides,
  which the store preserves and `list` labels; nothing is dropped.

## Testing plan

Unit tests (`src/ts/tests/*.spec.ts`) and stochastic tests (`*.stoch.ts`), in the
project's existing split:

- Registry: every key validates its own default's canonical form; every kind's
  validator accepts and canonicalizes representative valid inputs and rejects invalid
  ones with messages naming what is accepted.
- Stochastic: round-trip arbitrary valid ints/lists/strings through
  canonicalize→store→read→validate (fast-check, as the vocabulary tests already do);
  arbitrary invalid strings never write.
- `configure`: set-valid writes canonical text; set-invalid writes nothing and the
  reply names the constraint; unknown-key set stores and warns; `unset` restores the
  default and is a no-op when absent; `list` reports every registry key with source
  and labels unknown rows.
- Retention: synthetic `ts_utc` values straddling the horizon; `0` deletes nothing;
  `meta` and `config` untouched; `turn_context` pruned on the same horizon.
- Format stamping: an `express` write carries the constant by default and the
  override when set.
- `time.hook`: `'false'` drops the clock sentence, keeps the reminder, and the
  context row is still written; any other value keeps current behavior.

Real code is exercised in every case — the store, the registry, the actual tool
handlers via `buildServer` — never a hand-built expected object checked against
itself.

## Implementation checklist (post-approval)

1. `src/ts/channels/config.ts`: `FORMAT_VERSION`, `CONFIG_KEYS` registry, validators,
   canonicalization, tolerant effective-value accessor, `deleteConfig` in `store.ts`.
   DocBlocks throughout; export from `index.ts` if the public surface warrants it.
2. `configure` tool: wire validation (D2), unknown-key warning (D3), `unset` and
   effective `list` (D4); reply for `channels.enabled` notes the restart requirement
   (the enum is baked at server startup).
3. Retention: prune function in `channels/store.ts` or a small `channels/retention.ts`;
   call from `startStdio` after `openStore`.
4. Format stamping in the `express` handler (D7).
5. `time.hook` in `onUserPromptSubmit` (D9), including the clockless reminder wording.
6. Tests per the plan above; run the full build.
7. README: document the configuration surface (keys table, `configure` ops, precedence,
   `SELF_EXPRESSION_HOME`) in the generated source, not the emitted README.
8. Update `src/doc_md/plugin-layout.md` where it describes the config surface.
