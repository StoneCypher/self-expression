# Public aggregation carries structured fields only — design

2026-08-27 · refs issue #31 ("Public aggregation carries structured fields only, never
free text") · **proposal awaiting human review; implementation follows approval**

## Goal

Define the complete boundary between the local database and any public aggregation of
it: exactly which fields may leave the machine, in exactly what form, enforced at
exactly one point, previewable before anything goes, opt-in and never retroactive.

The governing decision is already made in the issue and is restated here as
non-negotiable: **free text is never part of a public aggregation.** This spec turns
that decision into a column-by-column contract, because "exclude `text`" alone is not
sufficient — several structured-looking columns are open vocabularies or identifiers
and leak just as badly.

One piece of the issue has already landed: `stem` is a real column with a `CHECK`
constraint against the closed `STEMS` vocabulary (`src/ts/channels/schema.ts`,
`src/ts/channels/vocabulary.ts`). The public affect signal it was promoted to carry
exists; what does not exist is any exporter, preview, or opt-in machinery. This spec
covers that remainder.

## Non-goals

- **No network submission in v1.** No aggregation server exists. v1 delivers a local
  export (a file the user can inspect and send however they choose) plus the preview.
  The transport — endpoint, authentication, receipt — is a separate issue once a
  server exists. This keeps the trust-critical boundary reviewable on its own.
- **No formal anonymity claim.** This design removes prose and breaks cross-submission
  linkage; it does not implement differential privacy or k-anonymity, and no wording
  anywhere in the tool or docs may imply it does. The honest claim is: *no free text,
  reduced linkage, coarsened time.*
- **No redaction pass over natural language**, ever, in any version. Rejected below.

## Threat model

What the boundary defends against, in priority order:

1. **Prose leakage.** `text` carries whatever the model wrote: client details, patient
   context, legal matters, credentials mentioned in passing, unreleased product names.
   `title`, `cwd`, `project`, `git_branch`, and `series_key` carry the same material in
   name form. Publication is unrecoverable; this failure mode dominates all others.
2. **Re-identification via quasi-identifiers.** `tz` is coarse location; fine
   timestamps plus session structure are a working-hours fingerprint; exact token and
   length counts are join keys against any other dataset holding the same session.
3. **Cross-submission linkage.** `machine_id`, `session`, and row `uuid` are stable
   identifiers. Two submissions sharing any of them merge into one longitudinal
   profile of one person, which no single submission consented to.
4. **Schema drift.** The schema will keep growing. Any design in which a future column
   is public unless someone remembers to exclude it will eventually leak — this is a
   *when*, not an *if*.
5. **Covert prose channels.** A field typed "structured" but accepting arbitrary
   strings (`agent_type`, `cctype`, `face`) is a text field wearing a costume. The
   boundary must classify fields by their *value domain*, not their column type.

Out of scope: a malicious local user (it is their own data), a compromised aggregation
server (v1 ships no transport), and traffic analysis of the eventual submission channel
(deferred with the transport).

## The architectural rule

**The export is an allowlist, never a denylist.** Every column is private unless it
appears in the treatment table below, and the exporter constructs its output
exclusively from that table — there is no `SELECT *` anywhere on the export path, so
an unlisted column is unreachable by construction rather than filtered out.

A second rule follows from threat 5: **a field is exportable only if its value domain
is closed, numeric, or validated down to one.** Closed vocabularies (`CHECK`-backed)
export verbatim; open strings either validate against a closed list at export time
(failing to `NULL`) or do not export at all.

And a third, from threat 4: **classification is total.** Every column of `entries`
must appear in the treatment table with an explicit treatment, including
`excluded` — and a test enforces totality against the DDL, so adding a schema column
without classifying it fails the build. This is what makes the allowlist fail safe
*forever* rather than only at review time.

## The treatment table

Five treatments: `verbatim`, `coarsen`, `hash`, `derive`, `excluded`.

### Verbatim — closed vocabularies and safe scalars

| column | why it is safe |
|---|---|
| `channel`, `position`, `delta`, `turn`, `effort`, `modality`, `confidence`, `divergence_kind`, `stem` | `CHECK`-constrained closed vocabularies; zero free characters possible |
| `uncertain`, `visible`, `nudged`, `interrupted` | booleans |
| `succ`, `active`, `fail`, `percent` | checklist counts; small bounded integers |
| `model` | the study variable — the whole point of the corpus; open by design (see `MODEL_FIELD_IS_OPEN`) but names a product, not a person |
| `platform` | already coarse (`win32` / `darwin` / `linux`) |
| `host` | host application name (`claude-code` etc.); product, not person |
| `plugin_version`, `format_version` | required to interpret rows; versions of *this* software |

`model` and `host` are the two open strings exported verbatim, accepted because their
content identifies software rather than people, and because normalizing them was
already explicitly rejected (`vocabulary.ts`). A length cap (64 chars) applies to both
purely as an abuse valve.

### Coarsen — signal kept, resolution destroyed

| column | treatment |
|---|---|
| `ts_utc` | truncated to the **hour** by default; configurable to day |
| `prompt_len`, `response_len`, `context_tokens`, `output_tokens`, `thinking_tokens`, `elapsed_ms` | log₂ bucket (0, 1–2, 3–4, 5–8, … as `pow2` bucket index); exact values are join keys, buckets are not |
| `tool_calls`, `error_count`, `compactions` | verbatim up to 32, then a single `33+` ceiling bucket |
| `host_version` | truncated to major version |

Rationale for hour-granularity `ts_utc`: day granularity would destroy every
time-of-day question the corpus could answer, and the residual risk is bounded because
nothing else in the export carries local time or zone (see `derive`). The
granularity is a submission-time choice surfaced in the preview, with hour as default.

### Hash — grouping survives, linkage dies

A single **per-submission salt** — 32 random bytes generated fresh at export time,
used for every hashed field in that export, and **never persisted**. Within one
submission, equal inputs hash equal, so grouping works; across submissions the salt
differs, so nothing joins. HMAC-SHA-256, output truncated to 128 bits, hex.

| column | note |
|---|---|
| `session` | groups a session's rows |
| `prompt_id` | groups one turn's rows (a need with its signature; two needs in one turn) |
| `machine_id` | distinguishes machines *within* a submission only |
| `agent_id` | groups a subagent's rows |
| `uuid` | row identity within the submission; **never exported raw** — raw uuids are stable across submissions and would re-link resubmitted rows |
| `corrects_id` | exported as the salted hash of the *target row's uuid* (a local rowid means nothing off-machine; the uuid hash keeps the correction edge inside the submission) |
| `series_key` | the key is a user-chosen *name* (free text); the hash keeps series grouping without the name |

### Derive — a safe field computed from unsafe ones

| exported field | derived from | domain |
|---|---|---|
| `local_period` | `ts_local` | `night` / `morning` / `afternoon` / `evening` (6-hour bands) |
| `local_dow` | `ts_local` | `weekday` / `weekend` |
| `is_subagent` | `agent_id IS NOT NULL` | boolean |
| `cctype` | `cctype`, validated against the closed conventional-commit type list (`feat`, `fix`, `hotfix`, `docs`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `style`, `release`, `revert`); anything else → `NULL` | closed |
| `face` | `face`, validated as **exactly one emoji grapheme**; anything else → `NULL` | bounded (~3.6k emoji) |

`local_period` is the deliberate replacement for exporting `tz` or a UTC offset:
circadian structure is genuinely affect-relevant, location is not. Stated residual
risk, accepted with eyes open: hour-granularity `ts_utc` plus a 6-hour `local_period`
band brackets the UTC offset to roughly a quarter of the globe — continent-scale, and
only when both fields are present. Reviewers preferring zero offset signal can strike
`local_period` or force day-granularity timestamps; the two knobs compose.

`face` is the one judgment call flagged explicitly for review: a single validated
emoji grapheme cannot carry prose and is a rich affect signal, but it is the loosest
domain in the export. Striking it costs nothing structural.

### Excluded — never exported, no derived form

`id` (local rowid), `text`, `title`, `cwd`, `project`, `git_branch`, `ts_local` (raw),
`tz`, `agent_type` (user-named open vocabulary — subagent names routinely embed
project and client names), `context_emoji` (multi-emoji, weaker convention than
`face`; revisit only with a validator as strict as `face`'s), `permission_mode`
(host-defined open string; can be promoted to verbatim if and when it gains a closed
vocabulary), `series_key` raw, `uuid` raw, `machine_id` raw, `session` raw,
`prompt_id` raw, `agent_id` raw, `corrects_id` raw, `turn_index` (fine-grained
session-structure fingerprint; the hashed `prompt_id` already groups turns).

The `turn_context`, `meta`, and `config` tables are excluded wholesale — the export
reads `entries` only.

## Enforcement point

One new module, `src/ts/channels/public_export.ts`, is the **only** code that shapes
rows for export, and everything else renders its output:

- `PUBLIC_TREATMENTS` — the table above as data: every `entries` column mapped to a
  treatment tag plus its parameters. Exported so tests and docs read the same object
  the exporter executes.
- Pure treatment functions (`coarsenHour`, `pow2Bucket`, `capCount`, `saltedHash`,
  `localPeriod`, `singleEmoji`, `closedOrNull`) — no I/O, individually testable.
- `exportPublicRows(store, salt, options)` — builds its `SELECT` column list from
  `PUBLIC_TREATMENTS`, applies treatments, returns `{ meta, rows }` where `meta`
  carries a random submission id, `SCHEMA_VERSION`, plugin version, the granularity
  options in force, and the export timestamp (itself coarsened to the chosen
  granularity). Serialized as one JSON document.
- `previewPublicExport(store, options)` — **calls `exportPublicRows` and renders its
  actual return value.** The preview cannot drift from the export because it *is* the
  export, minus only the final write. Rendered as a column-per-line sample plus the
  full treatment table with per-column disposition, so "here is exactly what would be
  sent" is literal.

Surface: an MCP tool (working name `share`, verbs `preview` / `export` / `status`),
consistent with #30's tool-first posture so all three hosts reach it identically. A
CLI subcommand may wrap the same functions; neither wrapper touches a row directly.

## Opt-in

- **Off by default, and inverted from `privacy.*`.** #30's privacy keys default to
  *on* (record locally), correct for a personal instrument. Sharing inverts the
  posture: only an exact affirmative value enables it, absence means no, any other
  value means no — the mirror image of `privacy.ts`'s "only exact `'false'`
  suppresses."
- **Opt-in is an event, not a flag.** Opting in stores the opt-in moment
  (`share.opted_in_utc`). Only rows with `ts_utc` at or after the **most recent**
  opt-in are eligible. Rows recorded before it are permanently outside the export,
  even after opting in — never retroactive, exactly as the issue requires. Opting
  out clears eligibility; a later re-opt-in starts a fresh window and deliberately
  forfeits the gap *and* the earlier window (fails safe; simpler than window
  bookkeeping and errs toward exporting less).
- **Every export requires the preview step.** The `export` verb refuses unless a
  preview was rendered for the same options in this session — mechanical enforcement
  of "the user saw what goes."

Key names (`share.enabled`, `share.opted_in_utc`, `share.time_granularity`) are
**suggestions pending #30**, which owns the config surface. This spec constrains the
semantics (default-off, exact-affirmative, event-based opt-in); #30 owns the naming
and the get/set mechanism, and this document defers to it on both.

## Alternatives rejected

- **Redacting the free text** (NER, regex, or model-based scrubbing) — no redaction
  pass over natural language is trustworthy enough, and failure is unrecoverable once
  published. The issue already made this call; recorded here so it is never relitigated
  in an implementation PR.
- **A denylist** — every future column public by default; fails open under schema
  growth. The totality test is the enforcement that makes the allowlist stick.
- **Exporting `tz` or a UTC offset bucket** (the issue's own initial suggestion) —
  even bucketed offset is location; `local_period` + `local_dow` keep the circadian
  and rhythm signal with no direct location field at all.
- **Hashing paths and titles instead of dropping them** — low-entropy names fall to
  dictionary attack; a hash of `acme-corp` is `acme-corp` to anyone who tries. Drop.
- **A stable submitter pseudonym** ("so we can track a contributor's history") —
  cross-submission linkage is precisely threat 3; refused on purpose, at the cost of
  never having longitudinal per-person series without a fresh, explicit consent design.
- **Exporting `turn_index` and exact counters** — together they reconstruct a
  fine-grained working-rhythm fingerprint (threat 2); grouping via hashed `prompt_id`
  plus bucketed counters keeps the analytical value.
- **`userConfig` / host-level toggles for opt-in** — Claude-only; #30 already rejected
  host-specific config surfaces, and a consent switch is the last place to fragment
  per host.
- **Differential privacy in v1** — no server, no aggregate release mechanism, tiny
  corpus; adding noise locally would degrade the instrument while the honest claim
  ("no prose, reduced linkage") is achievable structurally. Revisit with transport.

## Testing (post-approval)

- **Totality**: every column named in `ENTRIES_DDL` appears in `PUBLIC_TREATMENTS`
  exactly once — parsed from the DDL string, so a new schema column breaks this test
  until classified.
- **Sentinel-prose stochastic test** (the load-bearing one): generate entries with a
  unique random sentinel planted in *every* open-string field (`text`, `title`, `cwd`,
  `project`, `git_branch`, `series_key`, `agent_type`, `face`, `cctype`, …), export,
  serialize, and assert no sentinel substring appears anywhere in the output. Run
  under fast-check in the `*.stoch.ts` location.
- **Linkage**: two exports of the same store share no hashed value; one export hashes
  equal inputs equally.
- **Coarsening properties**: bucket monotonicity, hour truncation, `local_period`
  band edges, `33+` ceiling.
- **Validator fuzzing**: `singleEmoji` and `closedOrNull` reject multi-grapheme,
  ASCII prose, and mixed strings, stochastically.
- **Opt-in gate**: rows before the most recent opt-in never appear; unset and
  non-affirmative `share.enabled` export nothing; preview-before-export is enforced.
- **Preview identity**: the preview's row content is byte-identical to
  `exportPublicRows` output for the same store, salt, and options.

## Implementation checklist (follows approval)

- [ ] `src/ts/channels/public_export.ts`: `PUBLIC_TREATMENTS`, treatment functions,
      `exportPublicRows`, `previewPublicExport`, full DocBlocks
- [ ] Totality test wired to `ENTRIES_DDL`
- [ ] Sentinel-prose stochastic suite + linkage/coarsening/validator properties
- [ ] Opt-in gate reading the #30-agreed keys; never-retroactive filter + tests
- [ ] `share` MCP tool (`preview` / `export` / `status`) in `src/ts/mcp/`, error
      style matching `configure`
- [ ] Preview renderer (treatment table + sample rows) from the same code path
- [ ] README section stating the boundary, the honest claim, and the non-claims
- [ ] `plugin-layout.md` note for the new module
- [ ] Reconcile key names with #30 before merge

## Sequencing

Blocked on review of this document, and on #30 for key names only — everything except
the config gate is implementable against the semantics above while #30 settles naming.
`public_export.ts` plus its tests first (the boundary, pure), then the MCP tool, then
preview rendering, then docs.
