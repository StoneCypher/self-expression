# Changelog

All notable changes to this project will be documented in this file.

81 merges; 6 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__6__0">0.6.0</a>, <a href="#0__5__0">0.5.0</a>, <a href="#0__4__0">0.4.0</a>, <a href="#0__3__0">0.3.0</a>, <a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 11:47:31 AM

Commit [e6a6a3819ca6caf3da29318d12720c9613e0dde2](https://github.com/StoneCypher/self-expression/commit/e6a6a3819ca6caf3da29318d12720c9613e0dde2)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: ed16981de20124be481c047daa4279345fb9b9d4




&nbsp;

&nbsp;

<a name="0__6__0" />

## [0.6.0] - Aug 30, 2026 11:45:44 AM

Commit [ed16981de20124be481c047daa4279345fb9b9d4](https://github.com/StoneCypher/self-expression/commit/ed16981de20124be481c047daa4279345fb9b9d4)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [f2b034a, 88090b0]

  * Merge pull request #85 from StoneCypher/feat_26-08-28_desk-mechanism
  * feat: move the desk mechanism into the repo, cards as directories




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 11:42:36 AM

Commit [88090b0739c33030e2ccb4282e6f42f33a4ae97f](https://github.com/StoneCypher/self-expression/commit/88090b0739c33030e2ccb4282e6f42f33a4ae97f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: bump to 0.6.0 and regenerate artifacts after merging main
  * The second merge left this branch carrying main's 0.5.0, which main's own
release job will tag on its next push, so shipping it here would fail with
"422 tag_name already exists". git ls-remote --tags is the authority and
shows 0.2.0, 0.2.1, 0.3.0, 0.4.0 tagged; 0.6.0 is unused. Feature branch,
so MINOR with PATCH reset.
  * Regenerates every tracked build output against the merged tree: dist/,
coverage-stoch/, coverage-typedoc/, README.md, CHANGELOG.md,
CHANGELOG.long.md and their src/doc_md/ copies. The merge commit had reset
all of these to main wholesale, so this is a clean rebuild rather than a
patch over a textual hybrid of two branches' outputs.
  * The full canonical build passes — not the ci profile: 2135 unit tests
across 78 files, 234 stochastic tests across 37 files, and all four attw
resolution modes green.
  * One note for whoever hits it next: deskcards.stoch.ts "carries card source
through verbatim" timed out at 5000ms on the first attempt and passed on
re-run, taking 2.67s of test time in isolation. It does a mkdir plus four
file writes per property run across 24 runs, so it is I/O-bound and
sensitive to machine load rather than flaky in its logic. Worth a longer
timeout if it recurs.
  * Claude-Session: https://claude.ai/code/session_017b21rgf2bm9pMJuVgRik5L




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 11:36:32 AM

Commit [5b15973dcea1095d20772a49ad2536553a007b74](https://github.com/StoneCypher/self-expression/commit/5b15973dcea1095d20772a49ad2536553a007b74)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [9e15f20, f2b034a]

  * merge: origin/main into desk-mechanism (second pass, after #86 and #84)
  * Every tracked generated artifact is reset to main's side wholesale rather
than textually merged — dist/, coverage-stoch/, coverage-typedoc/,
CHANGELOG.md, CHANGELOG.long.md, src/doc_md/CHANGELOG*.md and README.md —
including the ones that did not conflict. A line-by-line merge of two
branches' build output is a hybrid of neither build; the following build
regenerates all of it from the merged sources anyway. (docs/ and coverage/
are untracked and need no handling.)
  * The only non-generated conflict was package.json's version line, resolved
to main's 0.5.0; the version bump follows in the next commit.
  * base_README.md and src/doc_md/plugin-layout.md, hand-integrated in the
previous pass, auto-merged cleanly this time — "The desk" and "Image
generation" both survive alongside main's newer sections.
  * src/scripts/desk/ is untouched: verified empty diff against the branch's
own HEAD. Landing this branch's desk copy as it stands is deliberate, so
that feat_26-08-29_cardkit's newer copy later arrives as the incoming side
of a merge in the normal direction of history.
  * Claude-Session: https://claude.ai/code/session_017b21rgf2bm9pMJuVgRik5L




&nbsp;

&nbsp;

<a name="0__5__0" />

## [0.5.0] - Aug 30, 2026 11:33:12 AM

Commit [f2b034aa991ea344296e1b4f38289a584fa45d77](https://github.com/StoneCypher/self-expression/commit/f2b034aa991ea344296e1b4f38289a584fa45d77)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [69c3830, 00334f8]

  * Merge pull request #84 from StoneCypher/feat_26-08-28_window-posture-keys
  * feat(config): window.browser and window.editor postures, and an enum kind




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 11:29:51 AM

Commit [00334f89cbbb61d9672906e56f6d1aa3292b9fae](https://github.com/StoneCypher/self-expression/commit/00334f89cbbb61d9672906e56f6d1aa3292b9fae)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(config): window.browser and window.editor postures, and an enum kind
  * Adds two configuration keys, `window.browser` and `window.editor`, each taking
`never`, `ask`, or `always`, and the `enum` config kind they are the first users
of. `share.time_granularity` moves onto that kind as well, so a closed two-word
domain reports itself as a choice set instead of as the word "string".
  * The keys are two rather than one because the costs differ: an external browser
window steals focus and can land while nobody is at the machine, while an editor
tab appears in the window the user is already sitting in. A single key would
force the expensive answer onto the cheap case.
  * They are advisory by construction, and say so. Nothing in this plugin gates
window opening — a shell command can open a browser with no MCP call at all, so
a gate would be a lock on one of several doors. What the plugin can do is put
the user's stated wish in front of the model at the moment the choice is made,
which is the new `windows:` segment on the turn-start context line. It fails
open on its own terms like every other segment.
  * Version bumped 0.4.0 -> 0.5.0. Main reached 0.4.0 while this branch was open, so
that number is spoken for; `git ls-remote --tags` is the authority on what has
shipped, since the Verify version bump job compares against the npm registry and
this package is unpublished, so it passes for any version at all (issue #99).
  * Rebuilt against main twice today, once for #97 and once for #86, both times
because tracked build output re-conflicts every open PR on files nobody edited
(issue #90).
  * Claude-Session: https://claude.ai/code/session_017b21rgf2bm9pMJuVgRik5L




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 11:23:28 AM

Commit [c919413546db8922464fd8898a0c1aaae999648b](https://github.com/StoneCypher/self-expression/commit/c919413546db8922464fd8898a0c1aaae999648b)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [6f2fc80, 69c3830]

  * Merge origin/main into feat_26-08-28_window-posture-keys
  * Second pass. Brings in #86 (the seriated matrix), which knocked this branch back
to CONFLICTING without anyone touching it.
  * 105 paths conflicted and every one of them was tracked build output: README.md,
which is generated from base_README.md, and 104 files under coverage-stoch/.
All took main's side and are regenerated by the build that follows, along with
dist/, coverage-typedoc/ and the changelogs, which merged without conflict but
are outputs either way and should not be hybrids of two branches.
  * Zero source conflicts this time. #86's work lives in src/ts/diagrams/matrix.ts
and src/ts/tests/diagram_matrix.stoch.ts; this branch touches channels/config.ts,
mcp/hooks.ts and their tests, so the two never met. base_README.md and
src/doc_md/plugin-layout.md auto-merged and were checked by hand afterwards.
  * This is issue #90 for the second time in one afternoon on one PR.
  * Claude-Session: https://claude.ai/code/session_017b21rgf2bm9pMJuVgRik5L




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 11:22:22 AM

Commit [612ba8977dbd0adaec7dd6402cf543790a43e9d6](https://github.com/StoneCypher/self-expression/commit/612ba8977dbd0adaec7dd6402cf543790a43e9d6)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: 69c3830a384ee4dca8562826968ae30dbef636a7




&nbsp;

&nbsp;

<a name="0__4__0" />

## [0.4.0] - Aug 30, 2026 11:20:54 AM

Commit [69c3830a384ee4dca8562826968ae30dbef636a7](https://github.com/StoneCypher/self-expression/commit/69c3830a384ee4dca8562826968ae30dbef636a7)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [ea0edaf, aa0beac]

  * Merge pull request #86 from StoneCypher/feat_26-08-29_seriated-matrix
  * feat(diagrams): seriated matrix — reorder a two-way table until its blocks show




&nbsp;

&nbsp;

## [Untagged] - Aug 30, 2026 10:39:33 AM

Commit [9e15f20c7c2cbd1d3ee4c2e974c177daf2d17063](https://github.com/StoneCypher/self-expression/commit/9e15f20c7c2cbd1d3ee4c2e974c177daf2d17063)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: bump to 0.4.0 and regenerate artifacts after merging main
  * The merge left this branch carrying main's 0.3.0, and tag 0.3.0 already
exists on the remote (confirmed via git ls-remote --tags), so the release
job would have failed with "422 tag_name already exists" once merged.
0.4.0 is unused. This is a feature branch, so MINOR with PATCH reset.
  * Regenerates every tracked build output against the merged tree: dist/,
coverage-stoch/, README.md, CHANGELOG.md, CHANGELOG.long.md and their
src/doc_md/ copies.
  * The full canonical build passes — not the ci profile: 2025 unit tests
across 77 files, 213 stochastic tests across 36 files, and all four attw
resolution modes green.
  * Note for future work in this worktree: node_modules was empty here, and
because the worktree is nested inside the main checkout, Node resolution
climbed to the outer repo and ran its vitest. That made process.argv[1]
point at the main checkout and failed the conventions.spec.ts package-root
assertion. npm ci in the worktree fixed it; no source change was needed.
  * Claude-Session: https://claude.ai/code/session_017b21rgf2bm9pMJuVgRik5L