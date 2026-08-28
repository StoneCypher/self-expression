# Compression as the mechanic — design

2026-08-27 · refs issue #20 ("Treat compression as the mechanic, not lists")

This is a proposal for human review, not an implemented decision. It settles a framing:
the status-checklist convention is one instance of a general **compression mechanic**,
and the replacement skill, the renderers, and the validator should be organized around
that mechanic rather than around lists. Per the issue's closing paragraph, this framing
is worth settling *before* the replacement skill is written, because it determines
whether the format is designed for task lists specifically or for compressed artifacts
generally. This document proposes: generally.

## Goal

Name the mechanic, pin its invariants, show that the existing conventions already obey
them, and define the small number of generalizations that follow — so that findings,
options, tradeoffs, diffs, and search results can be delivered at a chosen density with
the same verifiable machinery the checklist already has, instead of arriving as prose at
one fixed density that the reader must consume in full to discover whether they needed
any of it.

## Non-goals

- **No new visual forms.** Every glyph, bar, ramp, and layout rule stays exactly as
  pinned by the vendored references (`src/doc_md/reference/visuals.md`, `markers.md`,
  `status-checklists-skill.md`) and implemented in `src/ts/charts/` (#26, merged). This
  spec reorganizes what those forms *are instances of*; it does not redraw them.
- **No output changes to `renderChecklistSummary`.** The refactor proposed below is
  internal; the existing exact-string unit tests are the proof.
- **Not the replacement skill itself.** Writing the skill that supersedes
  `~/.claude/skills/status-checklists` is follow-on work (noted as such in the #26
  design). This spec fixes the frame that skill will be written in.
- **Not prose summarization.** An LLM-written abstract of a document is compression in
  the colloquial sense but fails the core invariant below (derivability), so it is out
  of scope on principle, not just out of scope for now.
- **Not diagrams.** See Relationship to other issues (#19).

## The claim, restated

A status checklist says twelve things in twelve lines and attaches a lossy summary —
counts, percent, progress bar, per-marker tallies — that can be read *instead of* the
items when the reader does not need detail. The items are the **expansion**; the
summary line is the **compression**. That is a density dial, not a list format.

The load-bearing property, already exploited by `check-checklist.mjs` and now computed
outright by `renderChecklistSummary`, is that the summary is **derivable from the
units below it**: it can be recomputed and verified rather than trusted. Any summary
that cannot be recomputed from its body is decoration, and decoration drifts.

## Vocabulary

This spec names the pieces so later documents can refer to them without re-deriving
the idea:

- A **compressed artifact** is a body of comparable units plus a digest derived from
  them, arranged so the digest can be read instead of the body.
- The **body** (the *expansion*) is the units themselves: one line per unit, each led
  by exactly one marker, in natural/pipeline order.
- A **unit** is one comparable thing — a task, a finding, an option, a changed file, a
  search hit. Units within one artifact must be comparable (countable under one noun);
  that comparability is what makes the tallies meaningful.
- The **digest** (the *compression*) is the fixed-shape summary derived from the body:
  today's summary line, generalized below.
- A **profile** is the per-domain parameterization of the digest: the unit noun, the
  bucket partition and its marker classification, and whether a scalar axis exists.
  The status checklist is one profile, not the format.

## The invariants

Six properties define a compressed artifact. The first is the mechanic; the rest make
it usable. Every existing rule in the checklist convention is an instance of one of
these, and every future compressed form must satisfy all six.

1. **Derivability.** The digest is a pure function of the body. Counts, percent, bar,
   icon list, and any per-profile scalar must be recomputable from the units alone —
   which is exactly what `check-checklist.mjs` checks after the fact and
   `renderChecklistSummary` guarantees by construction. If a candidate element of a
   digest cannot be recomputed from the body, it does not go in the digest.
2. **Partition.** The digest's count section is a partition: every unit is counted in
   exactly one bucket, the buckets appear in a canonical order, and the counts sum to
   the total. (Today: success/active+pending/failure, per `markers.md` § Bucket
   membership.) A profile may choose different buckets, but never overlapping or
   incomplete ones — a unit that fits no bucket goes in the profile's designated
   residual bucket, the way every unknown marker classifies active+pending today.
3. **Substitutability.** The digest answers "do I need the detail?" on its own. A
   reader who stops at the digest has a correct — lossy, but never misleading —
   picture. This is the density dial: digest only, digest plus lead line, or the full
   body, chosen by the reader, not by the writer.
4. **Fixed shape.** The digest has a fixed grammar per profile, so the eye
   pattern-matches instead of reading: position encodes meaning. This is glanceability,
   and it is why the counts are always three numbers in a fixed order even when one is
   zero, why the bar is always exactly 10 cells, and why the icon list sorts by a
   deterministic key.
5. **Conservation.** Compression is additive: nothing informative exists *only* in the
   digest. The body keeps everything; the digest merely re-states a projection of it.
   (The one deliberate exception is history: the trend sparkline compresses prior
   renders whose bodies are no longer on screen — which is why those renders must be
   logged, so the expansion remains reachable. See Composition rule 4.)
6. **Identity stability.** Across re-renders, units keep their order and wording and
   advance their marker in place, so the reader can diff renders by eye — and so the
   sequence of digests forms a meaningful series. Temporal compression (the trend)
   only works because of this; it is the same invariant the skill already states in
   § Re-rendering a checklist, promoted from etiquette to load-bearing rule.

## What the digest keeps and what it drops

The digest is lossy by design. Being explicit about the loss is what keeps it honest:

| kept in the digest | dropped from the digest |
|---|---|
| cardinality (how many units) | unit identity (which units) |
| the partition (how many in each bucket) | unit ordering |
| the distribution (per-marker tallies) | unit text |
| scalar position (percent + bar), when the profile has a scalar axis | everything qualitative |
| trajectory (trend over logged renders) | the individual prior renders |

One element deliberately breaks the pattern: the **lead line** keeps exactly one
unit's identity — the most salient one (the ❌/❗/🚫 needing attention; ✅ if nothing
does). It is the argmax of the body, a 1-unit compression sitting between the digest
(0 units of identity) and the body (all of them). That is the third notch on the
density dial, and it is why the lead line is optional and singular: two lead lines
would be a body.

This is the artifact-scale analog of #42's salience glyph ⭑ (PR #51), which marks the
load-bearing sentence of a whole response at a budget of one. Same move, different
scale; neither replaces the other. ⭑ lives in main prose and is never stored; the lead
line lives in the artifact's block. This spec inherits #42's design unchanged.

## How the existing conventions instantiate this

The point of the reframing is that the machinery already exists — it is just filed
under "lists." The mapping:

| existing convention | role under the mechanic |
|---|---|
| checklist items (`- <marker> <text>`) | the body: one line per unit, one marker per unit |
| count section `s/a/f` | the partition (invariant 2) |
| `(P%)` + 10-cell bar | scalar projection of the partition |
| per-marker icon list | the distribution: a histogram of the body |
| lead line | the argmax: one unit's identity retained |
| trend sparkline | temporal compression over logged digests |
| bold title `(scope)` | the domain declaration: what "100% of what" means |
| stacked bar (`renderStacked`) | the partition drawn proportionally instead of counted |
| win/loss strip (`renderWinLoss`) | a body so terse (one glyph per unit) it *is* its own digest |
| sub-item indentation rules | nested artifacts: a unit may itself be an artifact |
| `check-checklist.mjs` | the derivability verifier (invariant 1, checked after the fact) |
| `renderChecklistSummary` | the derivability constructor (invariant 1, by construction) |

Two consequences fall out of reading the table:

- `src/ts/charts/` is already a library of compressors: every renderer is
  `units → fixed-shape string`. Nothing in that directory is checklist-specific except
  `checklist.ts`, and even that is checklist-specific only in its profile (the
  three-bucket partition and the percent formula), not in its machinery (grouping,
  tallying, sorting, inline/block layout).
- The sparkline's `'absolute'`-scale rule for percent series ("comparable across
  checklists") is a compression invariant in disguise: digests of different artifacts
  must be comparable at a glance, so shared axes are pinned, not per-render.

## The general digest grammar

One line (plus the existing overflow block), fixed shape, per profile:

```text
<counts> <noun> [(<scalar>%) <bar>] [trend <sparkline>] <icon-list>
```

- **`<counts>`** — the partition counts joined by `/`, in the profile's canonical
  bucket order, all buckets always shown, summing to the unit total. Exactly today's
  rule with the bucket set as a parameter.
- **`<noun>`** — the profile's unit noun (`items`, `findings`, `options`, `files`,
  `hits`). One word, plural, fixed per profile; it is the reader's cue for which
  profile grammar to pattern-match.
- **`(<scalar>%) <bar>`** — present only when the profile defines a scalar axis: a
  pinned formula from the partition to `[0,100]`, rendered with the existing rounding
  and the existing 10-cell anti-aliased bar (`barCells`, unchanged). Profiles without
  a monotone axis omit both — no percent is fabricated (see Alternatives).
- **`trend <sparkline>`** — exactly today's rule: only when a logged series for this
  artifact has ≥ 4 points, `'absolute'` scale for scalar series.
- **`<icon-list>`** — exactly today's rules, unchanged and profile-independent:
  nonzero markers as `emoji count`, two-space separated, sorted count-descending with
  canonical-order tiebreak, inline at ≤ 8 distinct entries, block form at 9+, 12-entry
  wrap, blank-line separation when any bucket line wrapped.

The status-checklist summary line is this grammar with the checklist profile plugged
in — byte-identical to today, which is the compatibility requirement.

### Profiles

A profile is data, not code: `{ noun, buckets (ordered, with marker classification),
scalar formula or none }`. Four initial profiles beyond the checklist, matching the
issue's list. All reuse the `markers.md` glyph inventory — the vocabulary is shared;
only the partition semantics are per-profile. New glyphs are added to `markers.md`
(the single vocabulary file), never to a profile privately.

| profile | noun | buckets (canonical order) | scalar axis |
|---|---|---|---|
| checklist | items | success / active+pending / failure (per `markers.md`) | percent = success ÷ total |
| findings | findings | blocking (❗ 🦹 🌋 ❌ 🚫) / degraded (⚠️ 🌗 🐛 🤡 😕) / note (everything else) | none |
| options | options | chosen (✅ 👍) / open (🤔 ❓ ⏸️ and residual) / rejected (❌ 👎 ✋) | none |
| diff | files | added / modified / removed (classified by change kind, not marker) | none; `+N −M` line-count tail instead of a bar |
| results | hits | matched / partial (🌗) / missed (🦗 ❌) | none |

Worked examples of the digests these produce:

```text
0/3/9 findings  ⚠️ 5  🐛 3  ❗ 2  🔍 2
1/2/3 options  ❌ 3  🤔 2  ✅ 1
3/11/2 files +214 −96  🪚 6  📝 4  🧪 3  🗑️ 2  🔨 1
14/2/1 hits  🔍 14  🌗 2  🦗 1
```

Profile notes, in the order the issue lists the domains:

- **findings** — the digest a review or audit closes with: severity tallies readable
  instead of the findings. "Blocking" leads the bucket order because the digest's
  first number is the one a glance reads first, and for findings the blocker count is
  the headline. No scalar: 60% of findings being minor is not 60% of anything a bar
  should imply progress toward.
- **options** — the decision summary over per-option detail. The verdict *is* the
  lead line ("✅ chose sqlite: single-file, zero-daemon"), which the tradeoff case
  makes essential: a tradeoff artifact is an options artifact whose body carries the
  reasoning, and substitutability (invariant 3) means the verdict must be readable
  without the reasoning — verdict over reasoning, exactly as the issue puts it. When
  a decision is still open, `0/4/1 options` says *that* at a glance too.
- **diff** — the shape of the change over the hunks. `git diff --stat` is the prior
  art and the proof the mechanic predates this plugin; the profile restates it in the
  house grammar so it composes (icon list of work-kind markers per file, lead line on
  the riskiest file, trend over a branch's growth). Buckets classify by change kind
  rather than by marker — the first profile to exercise that degree of freedom, which
  is why it is worth having in the initial set.
- **results** — what was found over where. The digest answers "did the search pay?"
  before the reader commits to the where; the misses bucket (🦗 for a source that
  returned nothing) makes silent-miss reporting structural rather than optional.

Bucket assignments above are proposals to be reviewed, not settled vocabulary; the
settled version lands in `markers.md` (which is the live-read source of truth for the
validator) as a new "Profile bucket membership" section, alongside the existing
checklist buckets.

## Composition rules

These follow from the invariants and are the new normative content of this spec:

1. **A digest never travels alone.** A digest must accompany its body, or cite a
   reachable expansion (a logged render, a file, an earlier message in the same
   conversation). A free-floating digest is unverifiable, which violates derivability
   in spirit even when the numbers happen to be right. Citing form: the artifact's
   title, which is already the series key today (and becomes a stable id under #27).
2. **One artifact, one profile.** Units in one body are counted under one noun and
   one partition. Mixed content is two artifacts, not one artifact with mixed buckets
   — comparability of units is what makes every tally meaningful.
3. **Artifacts nest by digest substitution.** When a unit is itself a compressed
   artifact (a checklist item that is a sub-checklist; a finding that is a cluster),
   the child appears in the parent's body as one line carrying the child's *digest*,
   and counts as **one unit** in the parent's partition, bucketed by the child's
   overall state. This supersedes the current "count every item at every nesting
   level" rule **for cross-artifact nesting only**: within a single checklist,
   indentation levels remain plain sub-items counted individually, exactly as today.
   The distinction is whether the nested thing has its own digest — if it does, its
   digest is its representation, and double-counting its units in the parent would
   break the parent's partition.
4. **Compression of history requires logging.** The trend element compresses renders
   that are no longer visible, so each render must be logged (today's
   `log-checklist.mjs`; the MCP store under #10) for conservation to hold. No log, no
   trend — never a sparkline from memory.
5. **The density dial is the reader's.** The writer always emits body + digest (plus
   lead line when there is a headline); the writer never pre-decides that "the digest
   is enough" by omitting the body, except under rule 1's citation form. Emitting
   digest-only as a *progress ping* between full renders is legitimate precisely
   because the previous full render is the reachable expansion.
6. **Digest elements are closed per profile.** No ad-hoc extras in the digest line: a
   number that seems worth adding either becomes part of the profile's pinned grammar
   (and thus derivable and validator-checked) or belongs in the lead line as prose.
   This is the anti-drift rule, and it is the fixed-shape invariant applied to
   authors rather than renderers.

## Consequences for code

Deliberately small; the heavy lifting shipped with #26.

- **`charts/digest.ts`** — extract the profile-independent machinery of
  `checklist.ts` (grouping by `(marker, bucket)`, tallying, count-desc/canonical-rank
  sort, inline/block layout, 12-entry wrap) into a `renderDigest(units, profile,
  options)` core. `renderChecklistSummary` becomes the checklist-profile
  instantiation with its existing signature and **byte-identical output** — the
  existing exact-string specs in `src/ts/tests/checklist.spec.ts` and the stochastic
  suite are the acceptance gate for the refactor.
- **Profiles as data** — `charts/profiles.ts` in the `vocabulary.ts` / `markers.ts`
  pattern: exported `const` profile tables feeding validation and rendering, with the
  bucket membership sourced from the same section added to `markers.md`.
- **MCP** — one new tool `render_digest` (`units, profile, options`) beside
  `render_checklist_summary` in `chart_tools.ts`, using the same `tuple()`/`z.enum`
  machinery so a misspelled profile is unnameable. `render_checklist_summary` stays,
  as the checklist-profile alias — its callers should not need to know the framing
  changed.
- **Validator** — `check-checklist.mjs` generalizes to re-derive any profile's digest
  (profile inferred from the noun, per the fixed-grammar rule that the noun cues the
  profile). Same live-read of `markers.md`, same ok/FAIL report shape.

## Consequences for the replacement skill

The skill that supersedes `status-checklists` is written around the mechanic:

- **Trigger** — "about to present many comparable units," not "about to present task
  status." Findings, options, diffs, and search results trigger it exactly as task
  lists do.
- **Structure** — the invariants and composition rules (short), then the profiles as
  a table, then the checklist profile's specifics (markers, re-render etiquette,
  tooling) as the deepest-developed instance. The vendored references remain the
  normative source for glyph-level rules.
- **The observed behavior the issue cites** — a session kept reaching for the
  convention after the skill was deleted — is evidence the mechanic is load-bearing
  beyond its packaging; the replacement skill should teach the mechanic first so the
  transfer to new domains is deliberate rather than accidental.

## Relationship to other issues

- **#26 (merged)** — built the compressors this spec reorganizes; its "list-expression
  skill is separate follow-on work" note is the slot this spec's framing fills.
- **#42 / PR #51** — the salience glyph ⭑ is the response-scale analog of the lead
  line (see above); adopted as-is, not modified. Typed silence (🕳️ 🙈 🤐 🌊) composes
  naturally as unit markers in a results-profile body ("what was not found, and why
  not"), which this spec notes as a compatibility point, not a new requirement.
- **#27** — the stable series id replaces the title as the citation and trend key;
  composition rules 1 and 4 depend on it and inherit its resolution unchanged.
- **#10** — the MCP-ified logger is where rule 4's logging obligation lands.
- **#19 (diagrams)** — the boundary, stated so the two mechanics stay distinct: a
  diagram's payload is *structure* (edges, positions), which is not a derivable
  projection of a list of comparable units. Diagrams are a rendering mechanic;
  compression is a density mechanic. An artifact may contain a diagram; a diagram is
  not a digest.
- **#7 (PNG rendering)** — renders artifacts at a different fidelity; unaffected,
  because derivability is a property of the data, not the medium.

## Alternatives rejected

- **Keep the "lists" framing; add per-domain skills** (a findings-list skill, a
  decision-list skill, …). Rejected: N skills each restating the summary rules is N
  copies that drift independently — the exact failure mode `check-checklist.mjs`
  exists to catch, reintroduced at the documentation layer.
- **Freeform summaries, chosen per situation.** Rejected: violates fixed shape (no
  pattern-matching) and, in practice, derivability — a summary whose shape is
  improvised is a summary nobody can mechanically verify. This is the "decoration
  drifts" case from the issue, as a design choice instead of an accident.
- **Prose summarization as the compression** (an LLM-written abstract over the body).
  Rejected on the core invariant: not recomputable, therefore not verifiable,
  therefore trust-based — the reader must consume the body anyway to know whether the
  summary was faithful, which un-dials the density dial.
- **Force every profile onto the percent + bar.** Rejected: a bar implies a monotone
  axis with a completion end. "67% of findings are minor" invites exactly the wrong
  glance-read (two-thirds done). Profiles declare a scalar axis or omit the bar;
  fabricating one breaks substitutability, the invariant the bar exists to serve.
- **A single universal partition (success/active/failure) for every domain.**
  Rejected: it *almost* works (findings-as-failures, chosen-as-success), which is the
  trap — the near-fit quietly reads review findings as a 90%-failed project and a
  decided tradeoff as 25% complete. Shared glyph vocabulary, per-profile partitions.
- **Host-side collapsible rendering as the density dial** (`<details>`, folding UI).
  Rejected for the same reason #30 rejected host-native config: it exists on some
  hosts only, and the convention must survive a plain terminal code block. The dial
  is the artifact's *arrangement* (digest readable first/instead), not a widget.
- **Making the digest primary and the body optional everywhere.** Rejected:
  conservation. The digest is a projection; making it the artifact inverts the
  mechanic into exactly the "counts in prose" mistake the skill's Common Mistakes
  table already bans — trust me, it's 67% — with better typography.

## Testing

- The `digest.ts` extraction is gated on the existing checklist suites passing
  unchanged (exact-string and stochastic), plus new stochastic properties at the
  digest level: partition sums for arbitrary profiles, icon-list sort key, layout
  thresholds — the same properties currently proven for the checklist instance,
  quantified over profiles.
- Each new profile gets exact-string spec fixtures (the worked examples above become
  the pinned strings once bucket membership is settled) and a validator round-trip:
  render → re-derive → ok on every check.
- The generalized validator keeps `example.md` as its regression test and gains one
  worked example per profile.

## Implementation checklist (post-approval)

Sequenced; each step lands green independently. Effort per the issue label (3/5).

- [ ] `markers.md`: add the "Profile bucket membership" section (reviewed vocabulary
      from this spec's Profiles table); re-run the example-file regression check
- [ ] `charts/digest.ts`: extract the profile-independent core; `checklist.ts` becomes
      the checklist instantiation; all existing checklist specs pass byte-identical
- [ ] `charts/profiles.ts`: profile tables as data, with DocBlocks and `@see` links to
      the vendored references
- [ ] Digest-level stochastic specs; per-profile exact-string specs
- [ ] `chart_tools.ts`: `render_digest` MCP tool; `render_checklist_summary` delegates
- [ ] Generalize `check-checklist.mjs` to per-profile re-derivation; add per-profile
      worked examples beside `example.md`
- [ ] Update vendored `status-checklists-skill.md` § summary line to note it is the
      checklist profile of the digest grammar (pointer, not rewrite)
- [ ] README: Charts section gains the digest/profile surface (via the madlibs source)
- [ ] Write the replacement skill around the mechanic (own issue; blocked on this
      spec's approval, per the issue's final paragraph)
