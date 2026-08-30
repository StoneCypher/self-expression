# Changelog

All notable changes to this project will be documented in this file.

72 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 8:32:54 PM

Commit [0cb73a1a653eb7e45277ccb3ce4ba33f0abf6f5f](https://github.com/StoneCypher/self-expression/commit/0cb73a1a653eb7e45277ccb3ce4ba33f0abf6f5f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(image): generate images behind a user-supplied credential (#78)
  * Configuration names the environment variable; configuration never holds
the key. process.env[<the configured name>] is resolved at call time and
at no other time, and the key is never written to the config table, the
entries store, either ledger, a cache, or a temp file, and never rendered
in an error, a stack trace, a debug line, a tool reply, or a log. The
variable name is not a secret and is printed freely; that asymmetry is
what makes this configuration rather than storage.
  * - imagery/scrub.ts removes held secrets in every encoding a request
  carries them in, and credential shapes it was never given; the client,
  the ledger, and the tool apply it independently, and the tests break
  each guard separately to prove the others hold
- a provider registry: nanobanana, OpenAI, and a credential-free local
  endpoint. Adding a fourth is one entry, and no vendor is named outside
  providers.ts
- registration follows the credential: with no usable key the tool is
  absent from the schema entirely, and a legible stderr line names the
  empty variable
- per-session and rolling-per-day caps enforced server-side from the
  ledger; every refusal names the cap, its number, and the configure call
  that raises it
- a ledger row per attempt, written before the request rather than after,
  so a call that may have been billed cannot vanish with the process;
  the row stores the credential variable's name and there is no column a
  key could occupy
- images to <dataDir>/images/ honouring SELF_EXPRESSION_HOME; the reply
  carries the path, never the bytes
- content-policy refusals are reported plainly, and a reworded retry is
  blocked locally before any socket opens rather than being asked for




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 4:10:28 PM

Commit [365540f912d6b1a8c4eb98ecff863843dc10d439](https://github.com/StoneCypher/self-expression/commit/365540f912d6b1a8c4eb98ecff863843dc10d439)

Author: `John Haugeland <stonecypher@gmail.com>`

  * @
feat(desk): the card kit — 56 card types, the contract, and the tools that keep them honest
  * All of this existed only in a session scratchpad under %LOCALAPPDATA%\Temp, in a
directory named for a session uuid. It survived a reboot only by the grace of Windows
not clearing Temp by default, no future session would have found it without being told
the path, and any disk cleaner would have taken 56 card types with it. That is not a
home for four megabytes of work, so it has one now.
  * What is here:
  *   cardkit/kit.js, kit.css   the runtime and the idiom every card type shares
  cardkit/CONTRACT.md       the rules, most of which were learned by breaking them
  cardkit/categories.mjs    the ten questions a card can answer
  cardkit/newcard.mjs       list, show, and instantiate — with an install-time audit
  cardkit/check.mjs         conformance over the whole catalogue, self-tested 16 ways
  cardkit/adopt.mjs         every type onto a desk, with sample data
  cardkit/types/*.mjs       56 types, each hand-drawn: the CSP forbids a library
  cards/                    the deck as it stands, regenerable from adopt.mjs
  * Each type takes data and renders itself, so pointing one at a different repository is
an argument rather than a rewrite. Each is checked, executed against a stub, byte
scanned, and required to say in its own caption what it refused to draw.
@




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 1:19:31 PM

Commit [29570b7a05432ae6707ae4eab8d3aaab76497ef5](https://github.com/StoneCypher/self-expression/commit/29570b7a05432ae6707ae4eab8d3aaab76497ef5)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: regenerate the stochastic coverage report
  * coverage-stoch/ is tracked in this repo — the ignore rule is `coverage`, which
does not match it — so the build's coverage run leaves it modified. Kept in its
own commit on purpose: it is a few thousand lines of generated HTML, and letting
it ride along with source would bury the diff anyone actually needs to read.
Three new pages appear, for conventions.ts, resources.ts, and the v6 fixture.




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 1:19:02 PM

Commit [585f470571926e59893aca1cd08d9166180af016](https://github.com/StoneCypher/self-expression/commit/585f470571926e59893aca1cd08d9166180af016)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate dist for the second door
  * dist is tracked on purpose here (.gitignore un-ignores it explicitly, and
plugin-layout.md says so), so a change that alters what the bin does has to be
rebuilt or the committed bundle lies about the source beside it. One behavioural
change reaches the bundle: cli.cjs now hands the running bundle's directory to
startStdio, so an installed package finds its convention documents one level up
rather than searching for them. The rest is the toolchain's own churn.
  * Rebuilt with `npm run build -- --profile=fast` up to the point it stops on this
machine: `npm run dts` and the tail of `update_madlibs` shell out to POSIX `cp`
and `mkdir -p`, which cmd.exe does not have, so those two copies were performed
by hand with the same sources and destinations the scripts name. Everything
before them — clean, typescript, the full unit and stochastic suites with
coverage, rollup — ran green. The failure is a pre-existing Windows limitation of
the build scripts, not of this branch; CI runs on ubuntu-latest, where `cp`
exists.




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 1:18:28 PM

Commit [709c926a9c06f19d2c9bc5a17721c6c30ed91652](https://github.com/StoneCypher/self-expression/commit/709c926a9c06f19d2c9bc5a17721c6c30ed91652)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs: a Portability section, and the layout note on the second door
  * The README gains a Portability section stating exactly what now reaches a host
with no hooks and no skills: the seven convention resources and their URIs, the
`begin_turn` argument table, the `source` column and why a volunteered fact is
filed apart from an observed one, and a table of what each read surface used to
say versus what it says now. The schema-version line moves to 7 and notes that
the v6→v7 step is an ALTER rather than a rebuild.
  * plugin-layout.md gains the two decisions behind that: skills are shared across
three hosts *and served to the rest*, and nothing may depend on hooks alone.
The host-comparison table gains a turn-context row, and the tree names
resources.ts and the newly-packaged reference directory.
  * README.md is regenerated from base_README.md by the build's madlib step, so both
move together.




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 1:17:59 PM

Commit [4a1f1516207475deeb86b30b6dddff6fbcb5ef26](https://github.com/StoneCypher/self-expression/commit/4a1f1516207475deeb86b30b6dddff6fbcb5ef26)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(mcp): begin_turn, turn_context.source, and an absence that says so
  * Turn context reached the record through exactly one door: the UserPromptSubmit
hook, which is the least portable layer this plugin has. On a host that fires
nothing, every row landed with `no-hook` for a session and NULL for the turn
identity, the effort, and the permission mode — the record survived, and the
questions it exists to answer stopped being answerable.
  * `begin_turn` is the second door. The model volunteers what the hook would have
observed, and it goes through the same single INSERT in channels/context.ts:
same columns, same derived turn index, no second way to write the row, so the
two paths cannot drift into two shapes. It is idempotent by (session,
promptId) — a second call for one turn writes nothing and reports the row
already standing — which is what keeps that pair a *turn identity* rather than
letting one turn acquire two indices and two candidate answers to
latestContext. That is also what makes it harmless under Claude Code: it finds
the hook's row and says so.
  * `turn_context.source` (schema v7) records which door a row came through, `hook`
or `tool`. A volunteered fact and an observed one are not the same evidence —
the only witness for the second is the subject — and a study reading this
database later has to be able to separate them without inference. Rows written
before v7 keep NULL, which honestly means "written by a version that had only
the hook path"; nothing is backfilled onto a row nobody observed writing it
onto.
  * The migration is the first step in this chain that is not a table rebuild, and
that is worth stating: every earlier widening touched `entries`, whose
vocabularies are baked into CHECK constraints SQLite cannot alter in place.
`turn_context` has never carried a CHECK — not even on `turn` — so the v6→v7
step is one ALTER TABLE ADD COLUMN, guarded by a column-existence check because
SQLite has no ADD COLUMN IF NOT EXISTS. Keeping that table constraint-free is
now a deliberate property, documented where the DDL lives.
  * The v1–v5 fixtures were building their turn_context from the *live* schema
module, which was harmless while the table was immutable and silently wrong the
moment it was not: a "v1" database would have been built with a v7 table and the
migration would have had nothing to prove. The pre-v7 shape is frozen once, in
the oldest fixture, and re-exported by the later ones.
  * Riding along, because the two are one thought: **absence is now stated rather
than implied.** `turn_signed` has always answered `unknown` when it cannot
identify the turn; nothing else could say anything but `null`, and a null in a
`context` field reads as "nothing was happening" when the truth is "something
was happening and this host does not report it". So `recall` answers
`unknown — …` for both `context` and `previous`, following the existing
convention rather than inventing a second one, and `express`/`annotate` name the
`no-hook` placeholder in the reply instead of only in the database. `previous`
stays a plain null when the session *is* known and simply has no earlier
signature — that is a real "there is none", and a different answer from "nothing
was searched".
  * The two halves are one commit because they are genuinely coupled: the loud
message's whole value is that it names `begin_turn` as the fix, and both live in
the same two files.




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 1:17:15 PM

Commit [4a43a23b0314cb2cf96da8de217dc840854f61e9](https://github.com/StoneCypher/self-expression/commit/4a43a23b0314cb2cf96da8de217dc840854f61e9)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(mcp): serve the conventions as resources, for hosts that load no skills
  * Everything portable about this server already travelled: the tools are MCP
tools, config lives in the log database rather than host config, and onboarding
rides the initialize handshake's `instructions` precisely so it reaches hosts
that host-native prompting misses. The practice did not. The skills carry how a
signature is built, what each channel means, and why audio is scarce; a bare MCP
client loads none of them and gets `express` with no idea what good use of it
looks like.
  * The same files are now served as MCP resources at
`self-expression://conventions/<id>`, read off disk at request time so there is
exactly one copy of every word — no generated duplicate to rot, no build step.
  * Resources rather than a longer `instructions` string, deliberately. That string
is delivered unconditionally on every connection to every host, and the
documents run to roughly 88 KB. Sending them would be wasteful anywhere and
actively wrong on Claude Code, Codex, and Gemini, which already read these exact
files as skills: the model would receive the same text twice, from two channels,
with no way to tell it is one source. So `instructions` carries a three-sentence
pointer that names the resources and tells a host which already has the skills
to read nothing, and the documents themselves are pulled on demand.
  * The package root is found by a bounded upward search for the core skill file,
which works from `<pkg>/dist` in an installed package and from the repository
root under the test runner; `cli.ts` hands `__dirname` down as well, the way the
claudio bundle already locates its vendored WAVs. A package whose convention
files cannot be found registers no resources, omits the pointer, and serves
every tool exactly as before.
  * `src/doc_md/reference` joins `skills` in package.json's `files` list because the
checklist marker and visual references are read from the installed package at
runtime, exactly as the skills are. It is load-bearing, not speculative: without
it, three of the seven documents would be absent from a published install and
`availableConventions` would quietly serve four.




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 2:59:18 AM

Commit [f644382449a915772e000607bd0661a08a2b72fe](https://github.com/StoneCypher/self-expression/commit/f644382449a915772e000607bd0661a08a2b72fe)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(diagrams): seriated matrix — reorder a two-way table until its blocks show
  * Adds a `matrix` form to `render_diagram`, built on a new pure module
`src/ts/diagrams/matrix.ts`. The shading is the least of it; the reordering is
the capability. Given two key axes and a value per crossing, `seriate` orders
each axis so similar keys sit together, which surfaces block structure nothing
told it to look for.
  * Pinning is load-bearing, not a convenience. `pinRows` / `pinCols` freeze an axis
byte-identically in caller order, because an axis a reader already understands
(releases, weeks, severities) scores better reordered and reads worse.
  * The search is a barycentre sweep keeping the best-scoring pass, then adjacent
swaps, then single-key relocation, run as rounds to a fixed point — which is
what makes seriation idempotent. Adjacent swaps alone measurably could not move
a key past a cohesive group: over 4800 shuffled block-diagonal tables they
recovered 4567, and only 1368 of the 1600 two-key-block cases. With relocation
those became 4795 and 1596, and every remaining miss scores at least as well as
the labelled block order — a disagreement about the answer, not a failed search.
  * `seriationScore` (total adjacent profile distance along both axes, lower better)
comes back before and after, and the tool prints it, because a shaded matrix
looks structured whether or not anything was found.




&nbsp;

&nbsp;

## [Untagged] - Aug 29, 2026 2:59:18 AM

Commit [61e9ca31d4d8980f25cd8892bb8dcf7ccfa3b96e](https://github.com/StoneCypher/self-expression/commit/61e9ca31d4d8980f25cd8892bb8dcf7ccfa3b96e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * @
feat(diagrams): seriated matrix — reorder a two-way table until its blocks show
  * Adds a `matrix` form to `render_diagram`, built on a new pure module
`src/ts/diagrams/matrix.ts`. The shading is the least of it; the reordering is
the capability. Given two key axes and a value per crossing, `seriate` orders
each axis so similar keys sit together, which surfaces block structure nothing
told it to look for.
  * Pinning is load-bearing, not a convenience. `pinRows` / `pinCols` freeze an axis
byte-identically in caller order, because an axis a reader already understands
(releases, weeks, severities) scores better reordered and reads worse.
  * The search is a barycentre sweep keeping the best-scoring pass, then adjacent
swaps, then single-key relocation, run as rounds to a fixed point — which is
what makes seriation idempotent. Adjacent swaps alone measurably could not move
a key past a cohesive group: over 4800 shuffled block-diagonal tables they
recovered 4567, and only 1368 of the 1600 two-key-block cases. With relocation
those became 4795 and 1596, and every remaining miss scores at least as well as
the labelled block order — a disagreement about the answer, not a failed search.
  * `seriationScore` (total adjacent profile distance along both axes, lower better)
comes back before and after, and the tool prints it, because a shaded matrix
looks structured whether or not anything was found.
@




&nbsp;

&nbsp;

## [Untagged] - Aug 28, 2026 5:54:52 PM

Commit [c23b2f97a040f5f4499b58f82f419dab07f248c6](https://github.com/StoneCypher/self-expression/commit/c23b2f97a040f5f4499b58f82f419dab07f248c6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: move the desk mechanism into the repo, cards as directories
  * A desk is a local web panel — one page, one port, no build step, no
dependencies — that an assistant can put things onto while a session runs,
and that its owner can arrange, dismiss, and answer back from. It has been
living in a session scratchpad. What lands here is the mechanism only.
  * It lands in src/scripts/desk/, the repository's home for permanent
development scripts, rather than a new top-level directory or src/ts/: the
desk is run by hand, is deliberately unbuilt plain ESM so it can be started
and killed without installing anything, and is not part of any bundle, any
MCP surface, or the published files list.
  * The mechanism/contents split is the point. Checked in: panel.mjs (node:http,
node:sqlite, node:fs and nothing else), deskcards.mjs with hand-written
declarations, desk-shell.html and its three card placeholders, panel.html
(the still-monolithic second surface, copied as-is), two icons, and .example
files carrying the shape of every per-desk state file. Deliberately absent:
any desk's cards, board, art, name, questions, geometry, inbox, or vendored
node_modules. The desk directory is an argument rather than a default,
because two desks on one machine are normal and a desk that guessed where it
lived could quietly answer for the wrong one.
  * A card is a directory because removal must not be able to half-succeed. The
predecessor kept cards as markup inside one document and cut them out by
index; it failed twice, both times the same way — an attribute in an
unexpected order hid a card from its own deletion, and the JavaScript for
three deleted cards outlived them and threw on every load. Deleting a
directory cannot land two of three edits, and the page is assembled from
what is present rather than edited toward what should be.
  * Changed while moving, and why:
  * * Paths are parameters. The desk directory comes from argv[2],
  SELF_EXPRESSION_DESK, or the working directory; the port from
  SELF_EXPRESSION_DESK_PORT; the affect log from SELF_EXPRESSION_AFFECT_LOG
  or ~/.claude/affect-log.sqlite3. No absolute path to one machine survives.
* A missing affect log is reported once and the desk runs on. One desk's
  database must never be a requirement of the mechanism.
* Both file-serving routes now read before writing the status line. The
  prototype headed the response 200 first, so a miss threw
  ERR_HTTP_HEADERS_SENT instead of 404ing — never seen because the vendor
  tree always existed there, and immediate once absence became the default.
* The vendor route is generic: a desk vendors under vendor/node_modules/ and
  names things in its own importmap.json. The library-specific /jssm/ and
  /vendor/viz.js shortcuts and the two <script src="/jssm/…"> tags in the
  shell are gone — markup in the shell outliving the thing it was added for
  is the exact failure this mechanism exists to end.
* Removed a stranded DocBlock for a card that had already been deleted, and
  an orphaned </section> from an earlier index-based cut. Both were the small
  version of the same bug, preserved in amber.
  * Documentation: src/doc_md/desk.md carries the conventions — the card
contract, the two dismissal tiers (put away is reversible, forget deletes
outright, no tombstones), the inbox protocol (questions inline with up to
three option buttons, tasks and stuck rows on their own line, answers
one-way to the server log), the <main> hot-swap and its script/style
signature fallback, and the re-runnability rules card scripts must obey.
A README section and a plugin-layout decision entry summarise and link it.
  * Tests: deskcards.mjs gets unit and stochastic coverage against real
directories on a real filesystem — listCards ordering and its skipping of
directories without card.json, render concatenation order, removeCard
refusing unknown, path-shaped and fixed ids, and assemble filling all three
placeholders while treating $& inside card source as literal text. The
stochastic file is deliberately frugal with the disk: an earlier draft that
created and recursively deleted a tree per run starved the workers beside it
and timed out onboarding.stoch.ts.
  * eslint.config.js: node globals now reach src/scripts/**/*.mjs (the pattern
named a top-level scripts/ that no longer exists), and the desk's .d.mts
joins allowDefaultProject since no tsconfig owns it.