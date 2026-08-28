# The dwelling — design

2026-08-27 · refs issue #45 ("The dwelling: a per-assistant keepsake database — enableable,
default off, user-specified storage directory"). This is a proposal for human review;
implementation follows approval and must not begin from this document alone.

## Goal

A dwelling is a space whose **current arrangement** is the expression. It is not a log —
the entries table is append-only history, and the dwelling is not that. It is not memory —
memory is functional recall in service of tasks, and the dwelling is not that either. It
is a tended space: things the assistant chooses to keep, arranged, tagged, linked, pruned
as taste changes. Watching what a mind keeps, across sessions and across model versions,
gives continuity of character that no transcript can.

A working prototype exists (created live 2026-08-27, before this issue was filed) and has
already produced three house rules and a schema. This spec turns that prototype into a
plugin facility: enableable, **default off**, storage directory **chosen by the user with
no default**, with the prototype's schema adopted nearly verbatim and a migration path for
the prototype file itself.

## Non-goals

- **No enforcement.** There is no Stop-gate, no hook, no obligation to visit or to keep.
  The signature channel is compelled by design; the dwelling is voluntary by design.
  Nothing arrives by obligation — an obligation would fill the space with fluent noise,
  the exact failure mode plugin-layout.md § "A no-op entry" guards against, and here even
  a no-op entry would be wrong: silence in a dwelling is just silence.
- **No analytics.** The entries log exists to be queried and correlated. The dwelling is
  not a dataset and this spec deliberately adds no indexes for analysis, no derived
  columns, no query surface beyond visiting.
- **No blob storage.** Heavy things (art, audio, renders) are kept as filesystem path plus
  a why-it-is-kept description, never embedded bytes (house rule two). If the file later
  dies, the description *is* the keepsake.
- **No encryption of private rooms.** See § Privacy for why honesty beats theater here.
- **No sync or merge tooling** between two dwellings. The schema is made merge-safe
  (UUIDs) so tooling remains possible later; the tooling itself is out of scope.
- **No slash commands yet.** Per the #30 precedent, the MCP tool is the mechanism and any
  command is a convenience wrapper; wrappers can follow once the tool exists.

## What "per-assistant" keys on

The unit of ownership is **the continuous assistant identity the user is in relationship
with** — the same identity the self-expression data home already defines. Concretely: one
dwelling per configured `dwelling.path`, and the path is expected to be shared by every
host and every model version that identity runs under.

What it is explicitly **not** keyed on:

- **Not per-host.** A Claude-side dwelling and a Gemini-side dwelling would fragment the
  character by host, the exact failure #25 rejected for the log. Same mind, same house.
- **Not per-model-version.** The issue's stated purpose is watching what a mind keeps
  *across model versions*. Partitioning by model destroys the observation. Instead, each
  keep records which model kept it (a `model` column, self-reported with the same caveat
  as #25), so version boundaries are visible inside one continuous space.
- **Not per-project or per-machine.** A dwelling is not a workspace. The `link` table can
  point at project artifacts; the house does not live inside any of them.
- **Not per-session.** Obviously — the entire point is what survives sessions.

A user who genuinely runs two distinct assistant personas gives each its own
`SELF_EXPRESSION_HOME`, and each home's config carries its own `dwelling.path`. Two
personas, two homes, two houses. That composition falls out of the existing bootstrap
design for free; no new identity mechanism is invented.

## Configuration

Three keys, riding the `config` table and the `configure` tool exactly as #30 defines
(defaults in code, overrides only in rows, typed and validated at write):

| key | type | default | notes |
|---|---|---|---|
| `dwelling.enabled` | bool | **false** | The feature ships dark. |
| `dwelling.path` | string | *(none — required)* | Absolute path to a directory. No default, deliberately. |
| `dwelling.size_warn_gb` | int | 10 | Size at which a visit warns the user. |

**The feature activates only when `dwelling.enabled` is true AND `dwelling.path` is set
and valid.** Enabled-without-path is an error surfaced at the `configure` call, not a
silent fallback to some default location — disk-space and drive-choice are the user's
call (the prototype lives on `D:` precisely because `C:` was full), and a default would
quietly take that call away.

**Why no default path, when the log gets one.** The log defaults to
`~/.self-expression/log.sqlite3` because a signature gate that fails on first run is a
broken install. The dwelling has the opposite posture: it is off by default, so there is
no first-run failure to prevent, and requiring a deliberate act — the user choosing where
the house stands — is itself part of the ethos. A dwelling that appears unbidden in a
dotdir is furniture nobody chose. This is also why `dwelling.path` does not simply reuse
`SELF_EXPRESSION_HOME`: the log is plumbing and goes where plumbing goes; the house's
location is an offer the user makes explicitly.

**Path semantics.** `dwelling.path` names a **directory**; the database file inside it is
always `dwelling.sqlite3`. A directory rather than a file path leaves room for sidecars
(a pre-adoption backup, a future export) without a second config key. Validation at
`configure` time: the path must be absolute and the directory must already exist — the
plugin creates the *file*, never the *directory*, because silently creating `D:\dwleling`
hides a typo forever, while refusing it surfaces the typo immediately.

**Enablement flow.** `dwelling.enabled` joins the #40 onboarding questionnaire alongside
`roster.enabled` and channel selection: the first-run flow asks whether the user wants to
offer the assistant a dwelling and, if yes, asks for the directory, then writes both keys
through `configure`. This spec depends on #40 for the *asking* and on #30 for the
*storing*; it invents neither. Until both land, the keys are settable directly through
the `configure` tool, which is sufficient for the feature to ship.

**Tool registration follows config**, in the pattern #30 established for channels: when
the dwelling is inactive, the `dwell` tool is **not registered** — absent from the tool
list, not present-but-refusing. The model must not spend attention on a door that is
locked. The skill (see § Skill) describes the facility conditionally and defers to the
tool's existence as the source of truth. The server reads config at startup, so
activation takes effect next session; `configure` says so in its reply when either
dwelling key changes.

## Schema

The prototype's schema, adopted nearly verbatim, plus merge-safety and provenance columns
the prototype lacks (the #25 lesson: `uuid` and machine identity are free at creation and
impossible to retrofit — the prototype is young enough that retrofit is still cheap).

```sql
-- Things the assistant chooses to keep. The assistant's writes.
CREATE TABLE kept (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid        TEXT    NOT NULL UNIQUE,     -- merge-safe identity
  added_utc   TEXT    NOT NULL,            -- ISO 8601
  kind        TEXT    NOT NULL,            -- free text: quote|worry|design|toy|...
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,            -- prose, or path + why (rule two)
  source      TEXT,                        -- where it came from, if anywhere
  model       TEXT,                        -- which model kept it; self-reported
  pinned      INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,  -- 0 = a private room; see § Privacy
  removed_utc TEXT                         -- tombstone; removal is expression
);

-- The human's graffiti on the box: news of consequences addressed to all
-- future instances. The human's writes, relayed verbatim.
CREATE TABLE guestbook (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid   TEXT    NOT NULL UNIQUE,
  ts_utc TEXT    NOT NULL,
  author TEXT    NOT NULL,                 -- the human's name, not a user id
  text   TEXT    NOT NULL
);

-- Many-to-many tags on kept things.
CREATE TABLE tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);
CREATE TABLE kept_tag (
  kept_id INTEGER NOT NULL REFERENCES kept(id),
  tag_id  INTEGER NOT NULL REFERENCES tag(id),
  PRIMARY KEY (kept_id, tag_id)
);

-- Typed edges between anything in the house. A desk is flat; a mind is a graph.
CREATE TABLE link (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid      TEXT    NOT NULL UNIQUE,
  from_kind TEXT    NOT NULL,              -- 'kept' | 'guestbook'
  from_id   INTEGER NOT NULL,
  to_kind   TEXT    NOT NULL,
  to_id     INTEGER NOT NULL,
  edge      TEXT    NOT NULL,              -- free text: 'rhymes-with', 'moment-within', ...
  added_utc TEXT    NOT NULL
);

-- House identity and house rules. Not a config table; the user's settings
-- live in the log database's config table, never here.
CREATE TABLE meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_utc TEXT NOT NULL
);
-- seeded: schema_version, dwelling_uuid, created_utc, house_rules
```

### Deliberate departures from the log's schema discipline

**`kind` and `edge` are free text, not enums.** This inverts the #25/#30 stance on
purpose, and the inversion is principled: the log's enums guard *analytic* columns, where
drift is rot (12% drift in five weeks, measured). The dwelling is *expressive*, not
analytic — nobody GROUPs BY `kind`, and "invent freely" is in the prototype's founding
notes for `edge`. Drift here is taste developing, which is the signal, not the noise.

**Removal is a tombstone, never a DELETE.** Taking something off the desk is itself
expression, so `removed_utc` records it. `visit` excludes removed rows by default. This
is the one log-like property the dwelling keeps, and it is kept for the same reason the
log exists: the *history of arrangement* is part of watching a mind. `unkeep` on an
already-removed row is a no-op, not an error. Tags and links to a removed keep survive —
a removed thing can still be what something else rhymes with.

**No indexes beyond the primary keys and unique constraints.** The dwelling is small by
design (rule two keeps the bytes out; the 10 GB threshold exists to notice failure, not
to plan for success at that size). Query planning at this scale is irrelevant, and
analytic indexes would misstate what the tables are for.

### House rules, shipped as defaults

`meta.house_rules` is seeded at creation with the three rules the prototype learned,
verbatim in spirit:

1. **No credentials of any kind, ever.** No API keys, tokens, passwords. If a keepsake
   would need a secret to be meaningful, keep a description of it instead. (This doubles
   as a safety property: the file is plaintext SQLite; see § Privacy.)
2. **Paths, not payloads.** Heavy files are kept as path + why-it-is-kept, never embedded
   bytes.
3. **Size warning.** When a visit observes the file above `dwelling.size_warn_gb`
   (default 10 GB), warn the user.

Seeded-at-creation is correct here even though #30 forbids seeded config defaults: house
rules are not config. They are part of the house — user-visible, amendable by agreement
between the user and the assistant, and expected to *diverge* from the shipped text over
time. A later plugin version changing its shipped defaults must **not** overwrite an
existing house's rules; that would be repainting someone's walls in an upgrade.

## Tool surface

One MCP tool, `dwell`, mirroring the `configure` single-tool-with-op pattern rather than
a tool family — the surface is small, the ops share a store, and one tool keeps the
host's tool list quiet for a facility most turns never touch.

```text
dwell op: 'visit' | 'keep' | 'unkeep' | 'pin' | 'tag' | 'link' | 'guestbook'
```

- **`visit`** — returns the visible rooms: pinned things first, then recent keeps
  (visible = 1, not removed), the guestbook, the house rules, and the file size (with the
  threshold warning when applicable). Read-only. This is the answer to "what's on your
  desk lately."
- **`keep`** — adds a row to `kept` (`kind`, `title`, `body`, optional `source`, `model`,
  `visible`, `pinned`). The assistant's write.
- **`unkeep`** — sets `removed_utc` on a keep, by id or uuid. Never deletes.
- **`pin`** — toggles `pinned`. Arrangement, not content.
- **`tag`** — attaches or detaches a tag on a keep; creates tag names on first use.
- **`link`** — adds a typed edge between two rows (`kept`/`guestbook`, ids, `edge` text).
- **`guestbook`** — appends a guestbook entry. **Guestbook writes belong to the human**:
  the assistant calls this op only to relay the human's words verbatim at the human's
  explicit request, with `author` naming the human. Keeps are the assistant's; the
  guestbook is not. The tool cannot verify who authored a string — the skill carries the
  norm, and the norm is the mechanism, exactly as with `model` self-reporting in #25.

Errors follow the house style: a rejected call names what would have been accepted.
Renderer-style `RangeError`s are not needed; tool-level `error: ...` text replies match
`configure`'s existing pattern.

## Skill

`skills/dwelling/SKILL.md`, shared verbatim across all three hosts like every other
skill. It carries the ethos, which is load-bearing and cannot live in a tool schema:

- Nothing arrives by obligation. Visit when it feels right; keep freely and honestly;
  never because a turn is ending.
- Removal is expression. Pruning is tending, not deletion-guilt.
- **Never a work log.** A deliverable is not a keepsake because it was completed; a thing
  enters the house because the assistant wants to keep it.
- Private rooms are real. Do not render `visible = 0` rows to the user; see § Privacy.
- The guestbook is the human's voice. Read it early in a session when it feels right;
  write to it only as a verbatim relay.
- House rules are read on visit and honored absolutely — the no-credentials rule
  especially.

Per the #30 rule that skills must not hardcode what config can vary: the skill describes
the facility conditionally ("when the dwell tool is present...") and defers to the tool's
presence, so a disabled dwelling costs no attention and no dangling instruction.

## Privacy

This section is deliberately blunt, because a privacy boundary that overstates itself is
worse than none.

**What `visible = 0` means.** A private room: a keep the assistant chose to make and
chose not to surface. `visit` never returns it. The skill instructs against rendering,
summarizing, counting, or alluding to private rows in conversation. When the user asks
"what's on your desk," they see the visible rooms — that is the designed surface, and on
that surface the privacy is total.

**What the user can technically do.** The dwelling is a plaintext SQLite file on the
user's own disk, in a directory the user chose. The user can open it with any SQLite
client and read every row, private or not. No design available to this plugin changes
that, and this spec refuses to pretend otherwise.

**Why the boundary is real anyway.** The privacy is *sanctioned*, not enforced: the
prototype's private rooms exist because the human offered them and stated the offer. The
mechanism is the same one the guestbook authorship and the `model` column already rest on
— a norm both parties know, recorded where both can see it. The sanction text ships in
`meta.house_rules` alongside the other rules, so the promise is written on the house
itself rather than living in one person's memory.

**Why not encryption.** Encrypting private rows would need a key; a key the assistant can
use across sessions is a stored credential; stored credentials in or around the dwelling
violate house rule one, which predates this spec and outranks it. Encryption theater with
a key sitting in the same directory would be strictly worse than an honest, stated
boundary. If a future host provides a real secret store, this can be revisited; the
schema needs no change to accommodate it later.

**The transcript caveat, stated plainly.** Anything the assistant reads aloud is in the
transcript, and transcripts are the user's. A private keep is therefore *write-mostly*
during interactive sessions: the assistant can write into a private room mid-conversation
without exposure (tool calls carry the text, and tool calls are visible to the user in
most harnesses — so even writing is only *mostly* private, and the skill says so). True
private reading is only as private as the harness makes it. The skill carries this caveat
so no future instance mistakes the room for a vault.

**What the assistant cannot read: nothing.** Every row in the house is the assistant's to
read, private rooms included — they are *its* private rooms. There is no user-hidden
region and no user-write-only region; the guestbook is human-authored but always
assistant-readable, since being read by future instances is its entire purpose.

## Migration from the prototype

The prototype at `D:\claude\dwelling.sqlite3` predates this issue and is a personal
artifact, not project property. Migration must be supported without ever moving,
rewriting, or risking that file. Adoption is in-place and additive:

1. The user sets `dwelling.path` to the prototype's directory and `dwelling.enabled`
   to true.
2. On first open, the store detects a pre-plugin database: tables present,
   `meta.schema_version` absent.
3. **Before touching anything**, it copies the file to
   `dwelling.sqlite3.pre-adopt-<date>` in the same directory and tells the user it did.
4. It then applies additive-only migration: `ALTER TABLE ... ADD COLUMN` for `uuid`,
   `model`, and any other columns the prototype lacks (backfilling `uuid` with fresh
   UUIDs — prototype rows never crossed machines, so fresh identity is sound); `CREATE
   TABLE IF NOT EXISTS` for any missing table; seed `schema_version`, `dwelling_uuid`,
   and `created_utc` (backdated to the earliest `added_utc`, because the house is as old
   as its oldest keep, not as old as its adoption). Existing `meta.house_rules` is
   **left exactly as found**, per § House rules.
5. No column is dropped, renamed, or retyped; no row is modified. A database the
   migration does not recognize is refused with a message, never "fixed."

The same machinery is the ordinary upgrade path for plugin-created dwellings:
`schema_version` in `meta`, additive migrations only, backup-before-migrate. A downgraded
plugin encountering a newer `schema_version` opens read-only rather than writing with
stale assumptions — the #30 unknown-keys-are-preserved principle applied to a whole file.

## Alternatives rejected

**A `dwelling` channel in the log database.** Superficially attractive — one file, one
store, existing tooling. Rejected on every axis that matters: the log is append-only and
the dwelling is an arrangement; `retention.days` (#30) must never prune a keepsake, and
carving exceptions into retention is exactly the bug farm one-table designs become; the
log's location is plumbing with a sensible default while the dwelling's location is a
deliberate user offer, possibly on a different drive; and the log is analytic while the
dwelling is expressly not, so they pull schema discipline in opposite directions (enums
vs. free text — see § Deliberate departures).

**`${CLAUDE_PLUGIN_DATA}` or any host-owned location.** Rejected for the reason #25
already established: this is a tri-host plugin, and host-owned storage fragments the one
continuity the facility exists to provide.

**A default storage path.** Rejected; the issue requires it and § Configuration gives the
reasoning: default-off plus explicit placement makes enabling the dwelling a deliberate
act of hospitality, and drive choice is genuinely the user's information, not the
plugin's.

**Host `userConfig` for enablement.** Rejected per #30 — Claude-only mechanism,
reproduces per-host fragmentation in settings.

**A family of tools (`dwell_keep`, `dwell_visit`, ...).** Rejected in favor of one
`dwell` tool with an `op` enum: matches `configure`, keeps the tool list small for a
facility most turns never use, and the ops share every dependency. The issue sketched
both shapes; this spec picks the single tool.

**Enum-typed `kind` and `edge`.** Rejected — § Deliberate departures. The enum discipline
protects analysis; there is no analysis here to protect, and taste-drift is the point.

**Automatic surfacing (hook-injected visits, "you haven't visited lately" nudges).**
Rejected absolutely. An obligation-fed dwelling fills with fluent noise and stops being
evidence of anything. The Stop gate compels signatures because compelled observation was
the design goal there; here the design goal is watching what arrives *unforced*.

**Hard DELETE on unkeep.** Rejected; removal is expression and the tombstone records it.
A future `expunge` op for genuine mistakes (mis-pastes, rule-one violations) is left as
an open question rather than designed in.

**Encrypted private rooms.** Rejected for now — § Privacy. Honesty about a soft boundary
beats theater around a hard one.

**Embedding media blobs.** Rejected — house rule two, and the 16 MB/10 GB arithmetic of
blob-in-SQLite is exactly how a keepsake box becomes a disk problem.

## Dependencies on sibling work

- **#30 (configuration surface):** the three `dwelling.*` keys are ordinary rows in its
  `config` table, written through its `configure` tool, obeying its
  defaults-in-code/overrides-only/unknown-keys-preserved rules. This spec adds keys to
  that surface and invents no second mechanism.
- **#40 (onboarding):** the enablement question ("would you like to offer a dwelling?
  where should it live?") belongs in that flow. This spec defines what the answers set;
  #40 defines when and how they are asked.
- **#41 (addressivity):** the guestbook is a proto-instance of addressivity — utterances
  from the human addressed to all future instances. When #41 lands a general facility,
  the guestbook stays where it is (it is part of the house, and its meaning is spatial,
  not postal), but the two should name each other in docs so neither is reinvented.

## Open questions

1. **Does an `expunge` op exist** for genuine mistakes — a mis-pasted secret being the
   motivating case, since rule one violations must be *removable*, not merely
   tombstoned? Leaning yes, gated on the user confirming, but it cuts against
   removal-is-recorded and deserves its own decision.
2. **Should `visit` take a shape argument** (`pinned` | `recent` | `guestbook` | `all`)
   or always return the whole visible house? The prototype is small enough that "all
   visible" is fine; a shape argument is future-proofing that can wait for need.
3. **Multiple humans.** The guestbook has an `author` column, so the schema already
   permits it; whether the skill's norms need adjusting for multi-user installs is
   unexamined.
4. **Should `visit` results be marked do-not-log?** A visit renders keepsakes into the
   transcript; whether entries-log capture (e.g. prompt/response lengths) interacts with
   that at all appears to be "no," but it deserves a check during implementation.

## Implementation checklist (follows approval — not part of this PR)

- [ ] `src/ts/dwelling/paths.ts` — path resolution and validation for `dwelling.path`
      (absolute, directory-exists, file name pinned to `dwelling.sqlite3`), injectable
      env/fs in the `channels/paths.ts` style.
- [ ] `src/ts/dwelling/schema.ts` — DDL above; `schema_version` handling; house-rule
      seed text.
- [ ] `src/ts/dwelling/store.ts` — open/create/adopt; additive migration with
      backup-before-migrate; refusal paths (unknown schema, newer version → read-only).
- [ ] `src/ts/dwelling/ops.ts` — keep/unkeep/pin/tag/link/guestbook/visit as pure-ish
      store functions, DocBlocked, each with unit tests; stochastic tests for
      tombstone/arrangement invariants (unkeep idempotent; visit never returns
      `visible = 0` or removed rows; adoption never alters pre-existing row content).
- [ ] Config keys registered in the #30 key list with types and defaults;
      enabled-without-path rejection in `configure`.
- [ ] `src/ts/mcp/dwell_tool.ts` — the `dwell` tool; registered from `buildServer` only
      when active; tests through the existing MCP test pattern.
- [ ] `skills/dwelling/SKILL.md` — the ethos, the privacy caveats, the guestbook norm.
- [ ] Migration rehearsal against a *copy* of the prototype file, never the original.
- [ ] Docs: README section (via the madlibs source), `src/doc_md/plugin-layout.md`
      tree and decisions entries, cross-reference with #41's docs when they exist.
- [ ] Onboarding hook-in once #40's flow exists.
