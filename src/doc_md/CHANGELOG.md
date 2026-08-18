# Changelog

All notable changes to this project will be documented in this file.

Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:







&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 12:15:35 PM

Commit [a1d8a28c0c7eac36aa98f27ae3b3332a9c2cf5a0](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/a1d8a28c0c7eac36aa98f27ae3b3332a9c2cf5a0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: gate verify-version-bump against the template repo; bump to 0.20.1 (#33)
  * The verify-version-bump CI job runs verify_version_bump.cjs, which
calls `npm view react_ts_with_claude_gh_template version` to compare
the local version against the published version. The template package
isn't published, so npm view returns nothing valid and the job exits
non-zero on every CI run for this template repo.
  * Gates the job on GitHub's first-class is_template repository flag:
  *     if: github.event.repository.is_template != true
  * - This template has is_template: true → job is skipped here.
- "Use this template" creates a new repo with is_template: false →
  clones run the job normally.
- The release job's `needs: [..., verify-version-bump]` continues to
  work correctly: a skipped need cascades into a skipped dependent,
  which is the desired behavior on the template (we don't want to
  release the template itself).
  * Avoids the gross alternative of name-gating against this repo's
package name.
  * Closes #32




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 12:15:07 PM

Commit [a628506200be6df94e7dbed309b6ad8452d28655](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/a628506200be6df94e7dbed309b6ad8452d28655)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: gate verify-version-bump against the template repo; bump to 0.20.1
  * The verify-version-bump CI job runs verify_version_bump.cjs, which
calls `npm view react_ts_with_claude_gh_template version` to compare
the local version against the published version. The template package
isn't published, so npm view returns nothing valid and the job exits
non-zero on every CI run for this template repo.
  * Gates the job on GitHub's first-class is_template repository flag:
  *     if: github.event.repository.is_template != true
  * - This template has is_template: true → job is skipped here.
- "Use this template" creates a new repo with is_template: false →
  clones run the job normally.
- The release job's `needs: [..., verify-version-bump]` continues to
  work correctly: a skipped need cascades into a skipped dependent,
  which is the desired behavior on the template (we don't want to
  release the template itself).
  * Avoids the gross alternative of name-gating against this repo's
package name.
  * Closes #32




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:57:40 AM

Commit [340341aab5cee0cbc92da0fbf88eeb4f2ea2598a](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/340341aab5cee0cbc92da0fbf88eeb4f2ea2598a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: catch up version to 0.20.0 (#31)
  * Corrects the version-bump policy applied across the recent build-perf
PR series (#21–#30). I bumped PATCH each time when this project's
convention — both /sc-commit's intro paragraph and the project's own
git history (0.6.0, 0.7.0, 0.8.0, 0.9.0, 0.10.0 all minor bumps for
build/refactor work) — calls for MINOR per commit, with PATCH reset
to zero.
  * If MINOR had been applied per PR across the 10 merged PRs (baseline +
9 perf), the version trajectory would have been:
  *   0.10.7 → 0.11.0 → 0.12.0 → 0.13.0 → 0.14.0 → 0.15.0
         → 0.16.0 → 0.17.0 → 0.18.0 → 0.19.0 → 0.20.0
  * This single commit jumps from the actual 0.10.17 to the intended
0.20.0 so the published version matches the work that landed.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:57:13 AM

Commit [f2cede56d4d12e238c97bd7027bd4140a65c8474](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/f2cede56d4d12e238c97bd7027bd4140a65c8474)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: catch up version to 0.20.0
  * Corrects the version-bump policy applied across the recent build-perf
PR series (#21–#30). I bumped PATCH each time when this project's
convention — both /sc-commit's intro paragraph and the project's own
git history (0.6.0, 0.7.0, 0.8.0, 0.9.0, 0.10.0 all minor bumps for
build/refactor work) — calls for MINOR per commit, with PATCH reset
to zero.
  * If MINOR had been applied per PR across the 10 merged PRs (baseline +
9 perf), the version trajectory would have been:
  *   0.10.7 → 0.11.0 → 0.12.0 → 0.13.0 → 0.14.0 → 0.15.0
         → 0.16.0 → 0.17.0 → 0.18.0 → 0.19.0 → 0.20.0
  * This single commit jumps from the actual 0.10.17 to the intended
0.20.0 so the published version matches the work that landed.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 2:01:41 AM

Commit [20a9c106a021b1f837f8fc3770a117caf73ae6e6](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/20a9c106a021b1f837f8fc3770a117caf73ae6e6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): chunk build into parallel stages; bump to 0.10.17 (#30)
  * Replaces the 15-step `&&`-chain in the `build` npm script with a
Node orchestrator (src/build_js/run_build.js) that runs the build
as six topologically-correct parallel stages. Each stage's steps
run concurrently via spawn+Promise.all; stages run serially.
  * Stage layout:
  Stage 0: clean
  Stage 1 (parallel): typescript, docs#1, just_test_save, eslint,
                      cloc, changelog
  Stage 2 (parallel): update_madlibs, rollup, dts
  Stage 3 (parallel): viz_png, terser
  Stage 4 (parallel): docs#2, attw
  Stage 5: site
  * Stage boundaries reflect actual file-level dependencies:
  - update_madlibs needs coverage-typedoc.json (docs#1) and
    test_output.txt (just_test_save), so it follows Stage 1.
  - rollup only needs typescript output, so it runs alongside
    update_madlibs in Stage 2.
  - viz_png copies PNGs into docs/docs/, which docs#2 (typedoc)
    relocates into docs/docs/media/, so viz_png precedes docs#2.
  - site writes into docs/docs/; it follows docs#2 to avoid being
    wiped by typedoc's output-dir refresh.
  * No new dependencies — orchestrator uses just child_process from
the stdlib. Builds on the prior PR series: #17 moved tests off
the front so they could join Stage 1; #18 consolidated rollup
so Stage 2 can run a single rollup invocation; #14/#13/#12/#16
already parallelized their respective steps internally.
  * Closes #15




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 2:00:45 AM

Commit [5d98dc600c6391fdd548f12b235e0624a5b8886d](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/5d98dc600c6391fdd548f12b235e0624a5b8886d)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): chunk build into parallel stages; bump to 0.10.17
  * Replaces the 15-step `&&`-chain in the `build` npm script with a
Node orchestrator (src/build_js/run_build.js) that runs the build
as six topologically-correct parallel stages. Each stage's steps
run concurrently via spawn+Promise.all; stages run serially.
  * Stage layout:
  Stage 0: clean
  Stage 1 (parallel): typescript, docs#1, just_test_save, eslint,
                      cloc, changelog
  Stage 2 (parallel): update_madlibs, rollup, dts
  Stage 3 (parallel): viz_png, terser
  Stage 4 (parallel): docs#2, attw
  Stage 5: site
  * Stage boundaries reflect actual file-level dependencies:
  - update_madlibs needs coverage-typedoc.json (docs#1) and
    test_output.txt (just_test_save), so it follows Stage 1.
  - rollup only needs typescript output, so it runs alongside
    update_madlibs in Stage 2.
  - viz_png copies PNGs into docs/docs/, which docs#2 (typedoc)
    relocates into docs/docs/media/, so viz_png precedes docs#2.
  - site writes into docs/docs/; it follows docs#2 to avoid being
    wiped by typedoc's output-dir refresh.
  * No new dependencies — orchestrator uses just child_process from
the stdlib. Builds on the prior PR series: #17 moved tests off
the front so they could join Stage 1; #18 consolidated rollup
so Stage 2 can run a single rollup invocation; #14/#13/#12/#16
already parallelized their respective steps internally.
  * Closes #15




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:57:13 AM

Commit [3ab61405a5e42d110ff78565eeca923a6cd06646](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/3ab61405a5e42d110ff78565eeca923a6cd06646)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): move tests off the front of the build chain; bump to 0.10.16 (#29)
  * The `build` chain used to start with `just_test_save` — every other
step waited behind the full test suite even though typescript, the
first docs (typedoc) pass, and the test runner are mutually
independent (vitest reads source TS directly via its transformer
and doesn't depend on tsc output).
  * Moves `just_test_save` to just before `update_madlibs`. Tests still
run inside `build` (per project policy) and still feed
`update_madlibs` with current data — no staleness in the README
banner — but they no longer block the front of the chain.
  * The wall-time benefit lands when this is combined with #15
(parallel stages): with this PR's structural move, typescript,
docs#1, and just_test_save become an independent set that the
parallel-stages PR can put into a single concurrent stage.
  * Closes #17




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:56:22 AM

Commit [35fddbfc1b4f7e04c9a79f4dc2ea4f39bf747d68](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/35fddbfc1b4f7e04c9a79f4dc2ea4f39bf747d68)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): move tests off the front of the build chain; bump to 0.10.16
  * The `build` chain used to start with `just_test_save` — every other
step waited behind the full test suite even though typescript, the
first docs (typedoc) pass, and the test runner are mutually
independent (vitest reads source TS directly via its transformer
and doesn't depend on tsc output).
  * Moves `just_test_save` to just before `update_madlibs`. Tests still
run inside `build` (per project policy) and still feed
`update_madlibs` with current data — no staleness in the README
banner — but they no longer block the front of the chain.
  * The wall-time benefit lands when this is combined with #15
(parallel stages): with this PR's structural move, typescript,
docs#1, and just_test_save become an independent set that the
parallel-stages PR can put into a single concurrent stage.
  * Closes #17




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:52:33 AM

Commit [9b93c871b183a14d400c8f4a02ed67627a3952b8](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/9b93c871b183a14d400c8f4a02ed67627a3952b8)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): consolidate Rollup passes into one config; bump to 0.10.15 (#28)
  * Merges rollup.ctsphase.config.js into rollup.config.js so the build
runs `rollup -c` once instead of twice. One cold Rollup startup
eliminated.
  * The .d.cts emission config's input changes from `dist/index.d.ts`
(which used to be populated by the `dts` copy step earlier in the
build chain) to `build/ts/index.d.ts` (which `tsc --build` emits
directly). That removes the ordering dependency on `dts` and lets
the type-declaration bundle run alongside the ESM/CJS/IIFE bundles
in a single Rollup process.
  * Drops:
- rollup.ctsphase.config.js
- the `rollup-cts` npm script
- the `&& npm run rollup-cts` step from the build chain
  * The dts step still runs (it also copies stub.d.ts and the source
maps — those don't go through Rollup), but no longer feeds the
ctsphase config.
  * Closes #18




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:51:40 AM

Commit [bd107d7234218e20906d5892063e109041b988f2](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/bd107d7234218e20906d5892063e109041b988f2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): consolidate Rollup passes into one config; bump to 0.10.15
  * Merges rollup.ctsphase.config.js into rollup.config.js so the build
runs `rollup -c` once instead of twice. One cold Rollup startup
eliminated.
  * The .d.cts emission config's input changes from `dist/index.d.ts`
(which used to be populated by the `dts` copy step earlier in the
build chain) to `build/ts/index.d.ts` (which `tsc --build` emits
directly). That removes the ordering dependency on `dts` and lets
the type-declaration bundle run alongside the ESM/CJS/IIFE bundles
in a single Rollup process.
  * Drops:
- rollup.ctsphase.config.js
- the `rollup-cts` npm script
- the `&& npm run rollup-cts` step from the build chain
  * The dts step still runs (it also copies stub.d.ts and the source
maps — those don't go through Rollup), but no longer feeds the
ctsphase config.
  * Closes #18