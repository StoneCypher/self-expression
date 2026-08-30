# Changelog

All notable changes to this project will be documented in this file.

74 merges; 3 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__3__0">0.3.0</a>, <a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 10:14:36 AM

Commit [377fecfa299af56d76cf5f5be7633a4e158ff5df](https://github.com/StoneCypher/self-expression/commit/377fecfa299af56d76cf5f5be7633a4e158ff5df)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [f644382, ea0edaf]

  * Merge remote-tracking branch 'origin/main' into feat_26-08-29_seriated-matrix




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 8:00:08 AM

Commit [40ed4cf3c3dd5953dcc7c40677df4b9d9d00d726](https://github.com/StoneCypher/self-expression/commit/40ed4cf3c3dd5953dcc7c40677df4b9d9d00d726)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: ea0edafd59802101538511d7f8ec9ab63e349d46




&nbsp;

&nbsp;

<a name="0__3__0" />

## [0.3.0] - Aug 30, 2026 7:58:39 AM

Commit [ea0edafd59802101538511d7f8ec9ab63e349d46](https://github.com/StoneCypher/self-expression/commit/ea0edafd59802101538511d7f8ec9ab63e349d46)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [4ecc9b1, a587eb0]

  * Merge pull request #97 from StoneCypher/feat_26-08-29_image-generation_78
  * feat(image): generate images behind a user-supplied credential (#78)




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 7:34:27 AM

Commit [a587eb09eaabcd81cc8bd53a8d0344097c669c77](https://github.com/StoneCypher/self-expression/commit/a587eb09eaabcd81cc8bd53a8d0344097c669c77)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(store): tune SQLite pragmas, and fix a Windows-only build stop
  * `openStore` opened the database and set no pragmas, so SQLite's 2004-era
defaults applied: rollback-journal mode with `synchronous=FULL`, making
every write its own transaction with an fsync on each side of it. Measured
against this project's own store, that is 172 writes/sec against 11,236
with WAL and `synchronous=NORMAL` — sixty-five times. The cost was
invisible because the server writes a handful of rows per turn; it only
surfaced when a property test doing thousands of them began timing out at
60s, which is the first instrument anything had pointed at the store.
  * Also set, each checked rather than copied:
  * - `busy_timeout=5000` — the correctness one. Several sessions share one
  store, and without a timeout a second writer gets SQLITE_BUSY at once
  and the write is lost. WAL stops readers blocking the writer and does
  nothing for two writers.
- `foreign_keys=ON` — off by default forever, for compatibility. The
  schema declares five references and every one has been decorative.
  This lands before the plugin has ever been installed anywhere, so no
  database exists that could hold a violating row; the constraints simply
  begin life enforced, which is the only cheap moment to do it.
- `cache_size=-32000`, `temp_store=MEMORY`, `mmap_size=256MB`, and
  `analysis_limit=400` to bound `PRAGMA optimize`, now run at close so
  the query planner's statistics cannot go stale on a log that only grows.
  * WAL persists in the file header; the rest are per-connection, which is why
they live in `openStore` rather than in a migration.
  * The build could not complete on Windows: `dts` ran `mkdir -p` through
cmd.exe, which has no such flag, and died with "The syntax of the command
is incorrect" — so `npm run build`, and therefore the whole commit
workflow, was unusable on the machine this is developed on. CI is
ubuntu-latest and never saw it. Replaced with `src/build_js/copy_dts.js`,
and moved `update_madlibs`' trailing `cp README.md docs` into the script
that writes the README.
  * Two test changes ride along. `conventions.spec.ts` built a path fixture
with `join('C:', 'x', ...)`, which is absolute on Windows and an ordinary
relative path on POSIX — so it passed locally and failed on the Linux
runner, where `packageRoot` resolved it against the runner's own working
directory. Rebuilt on `resolve(sep, ...)`, absolute on both. And the
heaviest onboarding property was removed: its subset-and-preserve-unknowns
behaviour is covered by the three properties beside it and by the unit
suite, and it was buying a fourth angle on well-understood behaviour at
the highest runtime in the repo.
  * 2000 unit tests and the full stochastic suite pass with foreign keys
enforced. `dist/` regenerates byte-identical to the previous commit.
  * SQLite pragma tuning in openStore (WAL, synchronous NORMAL, busy_timeout,
foreign_keys, cache_size, temp_store, mmap_size, analysis_limit) plus
PRAGMA optimize at close; cross-platform path fixture in
conventions.spec.ts that was failing PR #97 on the Linux runner; removed
the heaviest onboarding stochastic property.




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