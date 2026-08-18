# Changelog

All notable changes to this project will be documented in this file.

1 merge; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:







&nbsp;

&nbsp;

## [Untagged] - Jun 5, 2026 10:30:48 PM

Commit [34b4b4c2488ffa975def00e911168c49e9ceeab8](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/34b4b4c2488ffa975def00e911168c49e9ceeab8)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: guard remaining jobs with right-sized timeout-minutes
  * Follow-up to the test-pr guard: cap the other jobs so a hung step fails
fast instead of running toward GitHub's 360-minute default. Sized per job
rather than a flat value:
  * - test-main-full: 20 min (full canonical build, npm run ci)
- test-main-matrix: 25 min (one ceiling across all cells; Windows/macOS
  installs are slower than Ubuntu)
- stryker: 45 min (mutation testing: install + full build + stryker run)




&nbsp;

&nbsp;

## [Untagged] - Jun 5, 2026 10:27:57 PM

Commit [507fc95fab255330246fc396342a94adce61ffcf](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/507fc95fab255330246fc396342a94adce61ffcf)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: add 6-minute timeout-minutes guard to PR check job
  * The test-pr (ci-lite) job had no timeout, so a hung step inherited
GitHub's 360-minute default. A stalled npm install / Playwright browser
download just ran for 69 minutes before being cancelled by hand. Normal
runtime is ~1.5 min, so cap the job at 6 minutes to fail fast.
  * Scoped to test-pr only: 6 min would be too tight for stryker (mutation
testing), the full build, and the Windows/macOS matrix cells, which need
larger ceilings of their own.




&nbsp;

&nbsp;

## [Untagged] - Jun 5, 2026 9:09:16 PM

Commit [2d9c6c092c8d82ae41bacd6144f401440e3a6854](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/2d9c6c092c8d82ae41bacd6144f401440e3a6854)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build(deps): refresh lockfile; bump to 0.20.4
  * Refresh package-lock.json to the transitive dependency versions
currently installed in node_modules, and bump the package version
0.20.3 -> 0.20.4 (PATCH; dependency/build maintenance, no source or
API changes).
  * Notable lockfile updates:
- rolldown 1.0.0-rc.12 -> 1.0.3 (plus all @rolldown/binding-* and
  @rolldown/pluginutils)
- vite 8.0.3 -> 8.0.16
- express 4.22.1 -> 4.22.2, body-parser 1.20.4 -> 1.20.5,
  qs 6.14.2 -> 6.15.2
- postcss 8.5.8 -> 8.5.15, nanoid 3.3.11 -> 3.3.12
- brace-expansion 5.0.5 -> 5.0.6, tinyglobby 0.2.15 -> 0.2.17,
  fast-uri 3.1.0 -> 3.1.2, @oxc-project/types 0.122.0 -> 0.133.0,
  @napi-rs/wasm-runtime 1.1.2 -> 1.1.4, @tybys/wasm-util 0.10.1 -> 0.10.2
- lockfile self-version caught up 0.10.9 -> 0.20.4
  * Rebuilt all tracked artifacts against the refreshed deps so they match
0.20.4: dist bundles, typedoc docs site, README madlibs, CHANGELOG,
bundle visualization PNGs, and stochastic coverage reports. Full build
is green: tsc and eslint clean, 29 unit + 4 stochastic tests pass, attw
reports no problems.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 12:01:02 PM

Commit [7b1a0256a5abc1d88a8853d0332471336d349872](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/7b1a0256a5abc1d88a8853d0332471336d349872)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: add #fullbuild escape hatch for opt-in full matrix on PRs
  * Adds a detect-fullbuild job that reads the PR head commit message and
sets a `fullbuild` output. test-main-full, test-main-matrix, and
stryker gate on (push event) OR (PR event with fullbuild=true). When
opt-in is active, test-pr is skipped (test-main-full covers it).
  * Default PR behavior unchanged: a single ci-lite job. Contributors who
need cross-platform verification before merge add `#fullbuild` to the
latest commit message on the PR branch.
  * Detection job is PR-only (`if: github.event_name == 'pull_request'`),
so push events incur no extra latency.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 12:01:02 PM

Commit [5cc69d26eda16f93400553786fc22450ecc92d18](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/5cc69d26eda16f93400553786fc22450ecc92d18)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: add #fullbuild escape hatch for opt-in full matrix on PRs
  * Adds a detect-fullbuild job that reads the PR head commit message and
sets a `fullbuild` output. test-main-full, test-main-matrix, and
stryker gate on (push event) OR (PR event with fullbuild=true). When
opt-in is active, test-pr is skipped (test-main-full covers it).
  * Default PR behavior unchanged: a single ci-lite job. Contributors who
need cross-platform verification before merge add `#fullbuild` to the
latest commit message on the PR branch.
  * Detection job is PR-only (`if: github.event_name == 'pull_request'`),
so push events incur no extra latency.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:57:47 AM

Commit [4b7a3b2f13fbb2166a3e086c54aa0d655e5820f0](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/4b7a3b2f13fbb2166a3e086c54aa0d655e5820f0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: lighten matrix and add cost optimizations; bump to 0.20.3
  * Wrap-up commit for PR #44, summarizing the CI infrastructure work that
landed in seven earlier commits on this branch:
  * - Split test job into test-pr (PR-only, ci-lite, Ubuntu-current) and
  test-main-full + test-main-matrix (push-only, full + lite split)
- Concurrency cancellation for PR iterations; main pushes are never
  cancelled (release safety)
- Cache Playwright browsers via PLAYWRIGHT_BROWSERS_PATH
- Drop Node 23 from non-Ubuntu cells (Ubuntu retains dual-Node)
- PR check uses ci-lite profile (lint/docs/site caught on main instead)
- paths-ignore for non-build documentation (specs, CONTRIBUTING,
  LICENSE, CHANGELOG)
- Add ci-lite profile to build.config.json (without eslint)
  * Net effect on a typical iteration: PR token cost drops to ~0.6× of the
original full build, concurrency cancellation kills superseded PR runs,
and push-to-main matrix shrinks from 6 cells to 4 (~43% reduction).




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:49:38 AM

Commit [5266cbd16d5be96e6903baa7f464dab0272eae69](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/5266cbd16d5be96e6903baa7f464dab0272eae69)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: skip CI for PRs that only touch non-build documentation
  * paths-ignore filter on pull_request trigger. If every file in a PR
matches the ignore list, CI doesn't run. Any non-doc file in the PR
flips it back on as usual.
  * Conservative list — only files the build genuinely doesn't read:
  src/superpowers/**/*.md  — planning specs/plans
  CONTRIBUTING.md, CODE_OF_CONDUCT.md, LICENSE
  CHANGELOG.md, CHANGELOG.long.md (generated; release reads main copy)
  * NOT skipped (intentionally): base_README.md (template input to
update_madlibs), src/doc_md/**/*.md (typedoc inputs), anything under
src/ts/ or src/build_js/, package.json, build.config*.json.
  * No paths-ignore on push: main pushes should always verify.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:49:14 AM

Commit [47e6b95a808fcff766bdc60c987f3bca1929ff3b](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/47e6b95a808fcff766bdc60c987f3bca1929ff3b)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: PR check uses ci-lite profile instead of full build
  * PR runs already pay for typecheck, tests, bundle, attw. The remaining
optionals (docs, eslint, cloc, changelog, viz_png, site) are
platform-invariant — test-main-full already produces them on every
push to main, so duplicating them on every PR push is wasted tokens.
  * Tradeoff: lint failures and docs/site rendering issues now surface on
merge to main rather than on the PR itself. test-main-full will block
the release job if anything regresses.
  * Estimated PR token cost: ~0.6× of the previous full build.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:45:44 AM

Commit [1f6981d355649a1ae0478f37b51adb3343abb4e5](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1f6981d355649a1ae0478f37b51adb3343abb4e5)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: drop Node 23 from non-Ubuntu cells in main matrix
  * macOS bills ~10× ubuntu; Windows ~2×. Running Node 23 on those for
"just in case" coverage is poor value per token. Keep Node 23 testing
on the cheap Ubuntu platform; macOS and Windows verify only Node 24
(the current release target).
  * Push-to-main cell count drops from 6 (1 full + 5 lite) to 4 (1 full +
3 lite). Token cost drops roughly 40% relative to the prior matrix.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:45:23 AM

Commit [1c887e0cafa90b558fb04152387253c0d51a2f1f](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1c887e0cafa90b558fb04152387253c0d51a2f1f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: cache Playwright browsers via PLAYWRIGHT_BROWSERS_PATH
  * The postinstall hook runs `npx playwright install --with-deps` on every
install. With nothing cached, that re-downloads ~100MB of Chromium per
cell per CI run. Cache hits skip the download entirely; only OS-level
deps (handled by apt incrementally) still re-run.
  * Cache key includes runner.os and a hash of package-lock.json so a
Playwright version bump invalidates the cache automatically.