# Changelog

All notable changes to this project will be documented in this file.

1 merge



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




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:43:43 AM

Commit [486854a593e26b77d4854f25a765d878cf86af90](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/486854a593e26b77d4854f25a765d878cf86af90)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: cancel in-progress PR runs when newer commits land




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:38:51 AM

Commit [393808b2b9cc88c97d984b94969cf81d258b3898](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/393808b2b9cc88c97d984b94969cf81d258b3898)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci(build): drop eslint from ci-lite profile




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 11:21:22 AM

Commit [87862d43cc14284389fc3c0ffa6023fb69b1d301](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/87862d43cc14284389fc3c0ffa6023fb69b1d301)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: lighten matrix — PR runs ubuntu-only; matrix only on main push
  * Reduces CI workload substantially. Three changes:
  * 1. PRs now run a single Ubuntu/Node 24 job with the full build, instead
   of the previous 6-cell matrix. Contributors get faster feedback and
   the project burns ~83% less CI on every PR push.
  * 2. Push to main splits into two jobs:
   - test-main-full (Ubuntu, Node 24) does the full build, producing
     docs, site, visualizations, changelog — artifacts that are
     platform-invariant.
   - test-main-matrix (5 cells: the other 3-OS × 2-Node combinations
     minus the Ubuntu/24 slot already covered) runs the new ci-lite
     profile, which skips docs/site/viz_png/changelog/cloc but keeps
     typecheck, tests, bundle, lint, and attw — the things that
     actually benefit from cross-platform verification.
  * 3. Stryker (mutation testing) moves from push+PR to push-only. It's
   expensive and a release-gate, not a contributor-gate.
  * The ci-lite profile is added to build.config.json alongside the existing
fast/ci/release profiles. It only specifies the optional features it
toggles off — everything else inherits its default-on state.




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 2:01:21 AM

Commit [926968546062e1b9c04655246e3754c815dd358f](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/926968546062e1b9c04655246e3754c815dd358f)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [5fda366, 7963ff5]

  * On feat_26-05-22_perf-coverage: session-local-settings




&nbsp;

&nbsp;

## [Untagged] - May 23, 2026 2:01:21 AM

Commit [7963ff5f90d599b6a5282e05be09e92299b285c1](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/7963ff5f90d599b6a5282e05be09e92299b285c1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * index on feat_26-05-22_perf-coverage: 5fda366 feat(build): add perf_coverage as opt-in stub for template forks




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:48:01 PM

Commit [5fda366bea168cb6cd680cd16940dd99c7dc23f3](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/5fda366bea168cb6cd680cd16940dd99c7dc23f3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add perf_coverage as opt-in stub for template forks




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:40:08 PM

Commit [c232aac04e3db5ff60c5ba6cdf6cf3fc64b63add](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/c232aac04e3db5ff60c5ba6cdf6cf3fc64b63add)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add a11y_coverage as opt-in stub for template forks




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:22:41 PM

Commit [2c36b291633b4dff519ca1eb188056f9ca5f9aa3](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/2c36b291633b4dff519ca1eb188056f9ca5f9aa3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): wire e2e (hosted_test) into build chain in stage 6
  * The existing src/build_js/hosted_test.js and src/ts/e2e/ tests have been
in the repo since before the configurable-build foundation but were never
invoked by npm run build. This adds the hosted_test npm script and a new
e2e feature in stage 6 (after site populates docs/). E2e auto-disables
if site is off, with a clear warning.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:17:34 PM

Commit [677145d95eeae81c9aaa82deed8532bcbe8abfb6](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/677145d95eeae81c9aaa82deed8532bcbe8abfb6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add example_coverage feature for @example tag coverage
  * Adds count_example_coverage.js that walks the TypeScript AST and reports
what fraction of documented exported symbols carry an @example JSDoc tag.
Registers example_coverage as an optional stage-1 feature in FEATURES,
build.config.json (on by default; disabled in fast profile), the JSON
schema, and clean.js; extends build_config.spec.ts with updated fixtures
and two new feature-specific tests.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 11:10:36 PM

Commit [75f2c86e55d49abc1285fdcc5582cbc9735526a4](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/75f2c86e55d49abc1285fdcc5582cbc9735526a4)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): replace typedoc#1 with fast AST-based doc_coverage script
  * Typedoc previously ran twice in the build chain — once at stage 1 to
produce coverage-typedoc.json for update_madlibs, once at stage 4 to
render the docs site after README was updated. Stage 1's HTML was
thrown away.
  * This adds a new doc_coverage feature whose runner walks the TypeScript
AST from src/ts/index.ts and counts documentable symbols with JSDoc.
It writes the same coverage-typedoc.json shape (percent, expected,
actual, notDocumented) so update_madlibs reads it transparently. Runs
in ~200ms vs typedoc's ~7s.
  * The docs feature's stages change from [1, 4] to [4] — final HTML
render only. Tests updated to expect doc_coverage in stage 1 and docs
only in stage 4.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 10:59:32 PM

Commit [daf8ebf036dbb72e1f2144286aa4fadda26be26f](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/daf8ebf036dbb72e1f2144286aa4fadda26be26f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add type_coverage feature to report % of non-any types
  * Add type_coverage feature to stage 1 of the build. Runs type-coverage with --json-output
to produce build/type-coverage/coverage.json containing {percent, totalCount, correctCount}.
  * - Create run_type_coverage.js to invoke CLI and parse JSON output
- Add 'type_coverage' to FEATURES catalog in build_config_schema.js
- Add type_coverage toggles to all build.config.json profiles (enabled in ci/release, disabled in fast)
- Add type_coverage property to build.config.schema.json FeatureFlags
- Add npm script 'type_coverage' to package.json
- Update build_config.spec.ts tests: add type_coverage to test fixtures and expected disabled lists
- Fix pre-existing typo in build.config.local.json (esling -> eslint)




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 10:59:19 PM

Commit [f594fccb1202eb83cc97eb523e2616d907e7eb50](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/f594fccb1202eb83cc97eb523e2616d907e7eb50)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore(deps): add type-coverage for type_coverage build feature




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 9:30:24 PM

Commit [1118a4e40519761412e386331949cefa138091c3](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1118a4e40519761412e386331949cefa138091c3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add license_check feature to scan dependency licenses
  * Introduces the license_check optional build feature that runs
license-checker to scan all project dependencies (prod + dev) and
generates a JSON report in build/license/coverage.json. Enabled by
default in standard, ci, and release profiles; disabled in fast
profile. Includes 2 new unit tests and updates 3 existing hardcoded
test expectations to account for the new feature.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 9:30:07 PM

Commit [f0daa9222a6bb275d57db330f93618d24eeb44c6](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/f0daa9222a6bb275d57db330f93618d24eeb44c6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore(deps): add license-checker for license_check build feature




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 8:37:01 PM

Commit [cc7c542e603f4ea687622cc322ea98a1bee8752c](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/cc7c542e603f4ea687622cc322ea98a1bee8752c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): configurable build via cascading JSON (#36)
  * * docs(build): add spec and plan for configurable build via cascading JSON
  * Foundation work for converting the hardcoded STAGES array in run_build.js
into a config-driven planner. Adds the design spec and the 11-task TDD
implementation plan; no code changes yet.
  * Future PRs (one per coverage type) extend the schema by a single entry.
  * * feat(build): add zod schema and FEATURES catalog for config-driven build
  * * feat(build): buildPlan reads base config and emits stage plan
  * * fix(build): drop unused argv/env locals from buildPlan (Task 3 will reintroduce)
  * * feat(build): apply selected profile (CLI > env var > none)
  * * feat(build): cascade env-file and local-file config layers
  * * feat(build): apply env-var and CLI feature overrides with only-conflict check
  * * feat(build): reject mandatory-feature disable and unknown-name override entries
  * * feat(build): cascade-disable optional features whose requires are off
  * * test(build): stochastic invariants for buildPlan (mandatory present, disabled absent)
  * * feat(build): run_build.js drives off buildPlan (config-driven)
  * * feat(build): add default build.config.json, JSON Schema, and gitignore for local overrides
  * * fix: add markdown code block language specifiers to plan and spec docs
  * * test(build): add drift-guard, env-var only-conflict, and --enable positive tests




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 8:09:17 PM

Commit [9c6cb88c44b9503ffc278f66036c08f22089c645](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/9c6cb88c44b9503ffc278f66036c08f22089c645)

Author: `John Haugeland <stonecypher@gmail.com>`

  * test(build): add drift-guard, env-var only-conflict, and --enable positive tests




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 8:02:12 PM

Commit [9aaa54c6cd6058183b96326620a263efe14245ea](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/9aaa54c6cd6058183b96326620a263efe14245ea)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: add markdown code block language specifiers to plan and spec docs




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:57:22 PM

Commit [c6bc46191f41f5f28aeab59e3c398a0c77666350](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/c6bc46191f41f5f28aeab59e3c398a0c77666350)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add default build.config.json, JSON Schema, and gitignore for local overrides




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:54:42 PM

Commit [78110a92dbf5729ce629995c54c5b5b63ee1f769](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/78110a92dbf5729ce629995c54c5b5b63ee1f769)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): run_build.js drives off buildPlan (config-driven)




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:50:28 PM

Commit [cf9afd63f99972d5f55f1a09915b4f9d8f0e0945](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/cf9afd63f99972d5f55f1a09915b4f9d8f0e0945)

Author: `John Haugeland <stonecypher@gmail.com>`

  * test(build): stochastic invariants for buildPlan (mandatory present, disabled absent)




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:42:13 PM

Commit [85fccdb958434bc3256da1ad4a91f3232618d608](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/85fccdb958434bc3256da1ad4a91f3232618d608)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): cascade-disable optional features whose requires are off




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:35:45 PM

Commit [9bab670ac7cde932918d427c5ae8b3a73b8f774b](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/9bab670ac7cde932918d427c5ae8b3a73b8f774b)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): reject mandatory-feature disable and unknown-name override entries




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:29:47 PM

Commit [aec7e3357cb30817967bf6ede86f35cadc675e61](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/aec7e3357cb30817967bf6ede86f35cadc675e61)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): apply env-var and CLI feature overrides with only-conflict check




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:23:33 PM

Commit [30ce81aab6ee5ddefd35b4d154683890c9ade53b](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/30ce81aab6ee5ddefd35b4d154683890c9ade53b)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): cascade env-file and local-file config layers




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:11:22 PM

Commit [576f9f3931dc0fa02bec0428b0a454e31973ab84](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/576f9f3931dc0fa02bec0428b0a454e31973ab84)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): apply selected profile (CLI > env var > none)




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:09:15 PM

Commit [d940ebf9495c2a5b3113b307b5efc11118c266a4](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/d940ebf9495c2a5b3113b307b5efc11118c266a4)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix(build): drop unused argv/env locals from buildPlan (Task 3 will reintroduce)




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 7:04:15 PM

Commit [e90305006faf13203ce5e579408a8f828d3b72eb](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/e90305006faf13203ce5e579408a8f828d3b72eb)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): buildPlan reads base config and emits stage plan




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 6:51:20 PM

Commit [b3483736ca116049b8a8e33acda8708329c239b0](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/b3483736ca116049b8a8e33acda8708329c239b0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add zod schema and FEATURES catalog for config-driven build




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 6:47:47 PM

Commit [6b9141d073aeb794422a076d8065481dc0959321](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/6b9141d073aeb794422a076d8065481dc0959321)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(build): add spec and plan for configurable build via cascading JSON
  * Foundation work for converting the hardcoded STAGES array in run_build.js
into a config-driven planner. Adds the design spec and the 11-task TDD
implementation plan; no code changes yet.
  * Future PRs (one per coverage type) extend the schema by a single entry.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 12:39:24 PM

Commit [527dec7695148e0bd403d46ba9d7d1bda969a248](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/527dec7695148e0bd403d46ba9d7d1bda969a248)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: verify_version_bump reads package name from package.json; bump to 0.20.2 (#35)
  * The script previously hardcoded the template's package name in its
`npm view` query (`npm view react_ts_with_claude_gh_template version`).
That was wrong on clones — after a cloner renames their package, the
script was still checking *this template's* published version, not
theirs. The verification would pass or fail for the wrong reasons.
  * Now reads `pJson.name` (already parsed from package.json on line 7)
and uses it in the npm view call, making the script self-detecting
for whatever package name is declared locally.
  * Also switches that call from `execSync` to `execFileSync` to satisfy
defensive practice: `execSync('npm view ${name} ...')` interpolates
into a shell command, which would be a command-injection vector if
`pJson.name` ever contained shell metacharacters (unrealistic for npm
package names, but `execFileSync` avoids the shell entirely so the
question doesn't come up). The unrelated `execSync('git show ...')`
call is left alone since its arguments are constant.
  * Closes #34




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 12:38:57 PM

Commit [4165ce4a754970a750a4eacb81e85e4e5f426043](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/4165ce4a754970a750a4eacb81e85e4e5f426043)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: verify_version_bump reads package name from package.json; bump to 0.20.2
  * The script previously hardcoded the template's package name in its
`npm view` query (`npm view react_ts_with_claude_gh_template version`).
That was wrong on clones — after a cloner renames their package, the
script was still checking *this template's* published version, not
theirs. The verification would pass or fail for the wrong reasons.
  * Now reads `pJson.name` (already parsed from package.json on line 7)
and uses it in the npm view call, making the script self-detecting
for whatever package name is declared locally.
  * Also switches that call from `execSync` to `execFileSync` to satisfy
defensive practice: `execSync('npm view ${name} ...')` interpolates
into a shell command, which would be a command-injection vector if
`pJson.name` ever contained shell metacharacters (unrealistic for npm
package names, but `execFileSync` avoids the shell entirely so the
question doesn't come up). The unrelated `execSync('git show ...')`
call is left alone since its arguments are constant.
  * Closes #34




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




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:45:52 AM

Commit [21e62010af8cdee03cb2038776125a8f072baea6](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/21e62010af8cdee03cb2038776125a8f072baea6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): reuse one Playwright browser across visualizations; bump to 0.10.14 (#27)
  * Replaces the spawn-per-conversion model in render_visualizations.js
(four child processes, each launching its own Chromium) with a
direct Playwright driver that launches one browser, opens four
pages on the same instance in parallel, screenshots each, and then
closes. Three of four browser launches eliminated.
  * html_to_png.js (the single-file CLI) is unchanged — still useful
for one-off conversions; the build's four-pack just bypasses it now.
  * Layers on top of #12 (which parallelized the previous spawn-based
model). With both PRs landed, viz_png pays exactly one Playwright
startup cost instead of four-sequential or four-parallel.
  * Closes #16




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:45:01 AM

Commit [ea481ec0b1c5b5d3a1ef6c7c4adbc7515cb4b5bc](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/ea481ec0b1c5b5d3a1ef6c7c4adbc7515cb4b5bc)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): reuse one Playwright browser across visualizations; bump to 0.10.14
  * Replaces the spawn-per-conversion model in render_visualizations.js
(four child processes, each launching its own Chromium) with a
direct Playwright driver that launches one browser, opens four
pages on the same instance in parallel, screenshots each, and then
closes. Three of four browser launches eliminated.
  * html_to_png.js (the single-file CLI) is unchanged — still useful
for one-off conversions; the build's four-pack just bypasses it now.
  * Layers on top of #12 (which parallelized the previous spawn-based
model). With both PRs landed, viz_png pays exactly one Playwright
startup cost instead of four-sequential or four-parallel.
  * Closes #16




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:42:06 AM

Commit [aa0f72e8e40d593707a38448b8871d61138be0e9](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/aa0f72e8e40d593707a38448b8871d61138be0e9)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): replace clean script's shell chain with Node; bump to 0.10.13 (#26)
  * Drops the 28-step serial `cd && rimraf && mkdir` chain in favor of
`node src/build_js/clean.js`, which wipes the five top-level output
dirs (src/ts/generated_code, build, dist, docs, coverage-typedoc)
and the four root-level bundle PNGs in parallel via fs.promises.
  * The work is staged in three phases — wipe top-levels, then mkdir
leaves with recursive:true, then unlink the bundle files — to avoid
the race where a parent-wipe and a child-mkdir step on each other.
  * Win is modest in wall time but bigger in readability and Windows
shell-emulation overhead.
  * Closes #19




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:41:14 AM

Commit [67bef19b036b0570569d742b67a89cdf1eadc9c2](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/67bef19b036b0570569d742b67a89cdf1eadc9c2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): replace clean script's shell chain with Node; bump to 0.10.13
  * Drops the 28-step serial `cd && rimraf && mkdir` chain in favor of
`node src/build_js/clean.js`, which wipes the five top-level output
dirs (src/ts/generated_code, build, dist, docs, coverage-typedoc)
and the four root-level bundle PNGs in parallel via fs.promises.
  * The work is staged in three phases — wipe top-levels, then mkdir
leaves with recursive:true, then unlink the bundle files — to avoid
the race where a parent-wipe and a child-mkdir step on each other.
  * Win is modest in wall time but bigger in readability and Windows
shell-emulation overhead.
  * Closes #19




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:39:10 AM

Commit [2ba9703373a39b8de3c917ea3ca4cddb47af66ae](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/2ba9703373a39b8de3c917ea3ca4cddb47af66ae)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): parallelize cloc passes; bump to 0.10.12 (#25)
  * Replaces two sequential cloc CLI invocations with a single Node
driver (src/build_js/run_cloc.js) that spawns the two passes in
parallel via Promise.all. The downstream cloc_report.cjs aggregator
stays in the npm script (it must wait for both passes to complete).
  * Driver invokes the cloc Perl script via a shell-string spawn — args
are hardcoded literals so there is no injection surface, and the
single-string form avoids the DEP0190 warning that fires when both
an args array and shell:true are passed together. Necessary because
newer Node refuses to spawn `.cmd` wrappers directly per the
CVE-2024-27980 mitigation.
  * Closes #14




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:38:15 AM

Commit [8a10966534a8b78ec962aef1a122b81374f632b1](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/8a10966534a8b78ec962aef1a122b81374f632b1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): parallelize cloc passes; bump to 0.10.12
  * Replaces two sequential cloc CLI invocations with a single Node
driver (src/build_js/run_cloc.js) that spawns the two passes in
parallel via Promise.all. The downstream cloc_report.cjs aggregator
stays in the npm script (it must wait for both passes to complete).
  * Driver invokes the cloc Perl script via a shell-string spawn — args
are hardcoded literals so there is no injection surface, and the
single-string form avoids the DEP0190 warning that fires when both
an args array and shell:true are passed together. Necessary because
newer Node refuses to spawn `.cmd` wrappers directly per the
CVE-2024-27980 mitigation.
  * Closes #14




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:33:24 AM

Commit [e3450790e8c76c6a3b7770fcc885709796f5a37e](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/e3450790e8c76c6a3b7770fcc885709796f5a37e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): parallelize terser minifications (#24)
  * * perf(build): parallelize terser minifications; bump to 0.10.11
  * Replaces three sequential terser CLI invocations with a single Node
driver (src/build_js/minify_bundles.js) that uses terser's API and
runs the three minifications in parallel via Promise.all.
  * Each bundle (ESM / CJS / IIFE) is an independent input/output pair
with its own source map, so they parallelize cleanly. Output source
maps still preserve the input maps' content so debuggers can trace
minified code back through Rollup to the TypeScript source.
  * The `cp dist/index.iife.js dist/index.iife.js.map docs` step that
distributes the IIFE bundle into docs/ is preserved in the npm
script after the parallel step.
  * Closes #13
  * * chore: refresh dist/docs bundles to match terser API output
  * Follow-up to the previous commit on this branch. The dist/* and
docs/* bundles are tracked in this repo and the new terser API
path produces functionally identical but byte-different output
(slightly more aggressive minification: `if (x) throw` instead of
`if (x) { throw }`, single-letter param names earlier).
  * Same semantics, smaller bytes, same source maps.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:32:49 AM

Commit [0a0e3e79e406dc4638a0ef02f07f313557e6753c](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/0a0e3e79e406dc4638a0ef02f07f313557e6753c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: refresh dist/docs bundles to match terser API output
  * Follow-up to the previous commit on this branch. The dist/* and
docs/* bundles are tracked in this repo and the new terser API
path produces functionally identical but byte-different output
(slightly more aggressive minification: `if (x) throw` instead of
`if (x) { throw }`, single-letter param names earlier).
  * Same semantics, smaller bytes, same source maps.




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:30:08 AM

Commit [4803ec3dbf434490fc99beb0dac89822fb74c5c6](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/4803ec3dbf434490fc99beb0dac89822fb74c5c6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): parallelize terser minifications; bump to 0.10.11
  * Replaces three sequential terser CLI invocations with a single Node
driver (src/build_js/minify_bundles.js) that uses terser's API and
runs the three minifications in parallel via Promise.all.
  * Each bundle (ESM / CJS / IIFE) is an independent input/output pair
with its own source map, so they parallelize cleanly. Output source
maps still preserve the input maps' content so debuggers can trace
minified code back through Rollup to the TypeScript source.
  * The `cp dist/index.iife.js dist/index.iife.js.map docs` step that
distributes the IIFE bundle into docs/ is preserved in the npm
script after the parallel step.
  * Closes #13




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:27:59 AM

Commit [40e531331b79192f1afa43d96979de43147b4a05](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/40e531331b79192f1afa43d96979de43147b4a05)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): parallelize viz_png conversions; bump to 0.10.10 (#23)
  * Replaces four sequential `node html_to_png.js` invocations with a
single Node driver (src/build_js/render_visualizations.js) that
spawns the four renderers as parallel child processes and waits
for all of them via Promise.all.
  * Wall time on the viz_png step drops substantially — the 4 Playwright
browser launches now overlap rather than running back-to-back.
A further optimization (one browser reused across all 4 conversions)
is tracked separately as #16.
  * The cp commands that distribute the PNGs to root, docs/, and
docs/docs/ are preserved in the npm script after the parallel step.
  * Closes #12




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:27:03 AM

Commit [d83fbb7e596bcf03208683c23f7b25c186aa7302](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/d83fbb7e596bcf03208683c23f7b25c186aa7302)

Author: `John Haugeland <stonecypher@gmail.com>`

  * perf(build): parallelize viz_png conversions; bump to 0.10.10
  * Replaces four sequential `node html_to_png.js` invocations with a
single Node driver (src/build_js/render_visualizations.js) that
spawns the four renderers as parallel child processes and waits
for all of them via Promise.all.
  * Wall time on the viz_png step drops substantially — the 4 Playwright
browser launches now overlap rather than running back-to-back.
A further optimization (one browser reused across all 4 conversions)
is tracked separately as #16.
  * The cp commands that distribute the PNGs to root, docs/, and
docs/docs/ are preserved in the npm script after the parallel step.
  * Closes #12




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:11:17 AM

Commit [6e3db7f7ccf0df58a04ff0620c10998f325093b4](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/6e3db7f7ccf0df58a04ff0620c10998f325093b4)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore(deps): bump better_git_changelog floor to ^1.6.16; bump to 0.10.9 (#22)
  * The previous baseline upgraded the installed version to 1.6.16 but
left the declared floor at ^1.6.5 (npm's default behavior on
@latest install). This aligns the declared floor with the installed
version so future installs cannot fall back to older 1.6.x releases.
  * Closes #20




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:05:59 AM

Commit [bbbc26f4f5d5c3e3a0716024a03fd8883875d6e2](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/bbbc26f4f5d5c3e3a0716024a03fd8883875d6e2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore(deps): bump better_git_changelog floor to ^1.6.16; bump to 0.10.9
  * The previous baseline upgraded the installed version to 1.6.16 but
left the declared floor at ^1.6.5 (npm's default behavior on
@latest install). This aligns the declared floor with the installed
version so future installs cannot fall back to older 1.6.x releases.
  * Closes #20




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 1:00:03 AM

Commit [fba8d63fc796fe07e3752e5b5f314969f8920db2](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/fba8d63fc796fe07e3752e5b5f314969f8920db2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: baseline cleanup; bump to 0.10.8 (#21)
  * Bundles pre-existing working-tree state into one commit so the
forthcoming perf PR series starts from a clean main:
  * - Upgrade better_git_changelog 1.6.3 → 1.6.16 (devDep; declared
  floor remains ^1.6.5 — the literal floor bump is its own PR
  per issue #20)
- Empty CLAUDE.md (intentional)
- Refresh auto-generated build artifacts (typedoc output,
  bundle PNGs, coverage-stoch reports, CHANGELOG, README banner)
- Add a 'Fast and slow build paths' usability entry to the
  tasklist and resolve three governance items as declined
- Extend .claude/settings.local.json with npm/gh permissions
  needed for the upcoming workflow




&nbsp;

&nbsp;

## [Untagged] - May 22, 2026 12:57:34 AM

Commit [4e08d00e74454570b4e5742e505043a93dbb1283](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/4e08d00e74454570b4e5742e505043a93dbb1283)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: baseline cleanup; bump to 0.10.8
  * Bundles pre-existing working-tree state into one commit so the
forthcoming perf PR series starts from a clean main:
  * - Upgrade better_git_changelog 1.6.3 → 1.6.16 (devDep; declared
  floor remains ^1.6.5 — the literal floor bump is its own PR
  per issue #20)
- Empty CLAUDE.md (intentional)
- Refresh auto-generated build artifacts (typedoc output,
  bundle PNGs, coverage-stoch reports, CHANGELOG, README banner)
- Add a 'Fast and slow build paths' usability entry to the
  tasklist and resolve three governance items as declined
- Extend .claude/settings.local.json with npm/gh permissions
  needed for the upcoming workflow




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 9:58:35 PM

Commit [392cb49441ef2b774ce648e6792fe87ceeafe49a](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/392cb49441ef2b774ce648e6792fe87ceeafe49a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: replace last TODO in verify_version_bump and rename tasklist header; bump to 0.10.7




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 9:51:31 PM

Commit [004e224cfdac1d0ed2893e9a3881aee62e5a53be](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/004e224cfdac1d0ed2893e9a3881aee62e5a53be)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: replace TODO placeholders with project name; bump to 0.10.6
  * Replace all TODO placeholders in package.json, rollup.config.js, and
base_README.md with the actual project name. Update GitHub links,
homepage, repository URL, and setup checklist to reflect the real
project identity.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 9:51:31 PM

Commit [b52f2e9a9ccdfc07a67bb62219e04ffd65f0c8e1](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/b52f2e9a9ccdfc07a67bb62219e04ffd65f0c8e1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: replace TODO placeholders with project name; bump to 0.10.6
  * Replace all TODO placeholders in package.json, rollup.config.js, and
base_README.md with the actual project name. Update GitHub links,
homepage, repository URL, and setup checklist to reflect the real
project identity.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 9:30:17 PM

Commit [412798bfad44e174ad1716c9755ce920999e0b41](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/412798bfad44e174ad1716c9755ce920999e0b41)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: add @faker-js/faker, issue templates, and tasklist updates; bump to 0.10.5
  * Add @faker-js/faker dev dependency. Add GitHub issue templates for
bug reports and feature requests. Update tasklist with completed
items (release automation, mutation testing) and declined items
(pre-commit hooks, dependency auditing, license scanning, import
sorting, canary releases).




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 9:30:17 PM

Commit [45fba51d416798b345726174215f0add48bfa860](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/45fba51d416798b345726174215f0add48bfa860)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore: add @faker-js/faker, issue templates, and tasklist updates; bump to 0.10.5
  * Add @faker-js/faker dev dependency. Add GitHub issue templates for
bug reports and feature requests. Update tasklist with completed
items (release automation, mutation testing) and declined items
(pre-commit hooks, dependency auditing, license scanning, import
sorting, canary releases).




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 9:04:18 PM

Commit [9f34069c7f9b7bc46252bc10f39c46aa7c67731c](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/9f34069c7f9b7bc46252bc10f39c46aa7c67731c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: configure Stryker mutation testing and add CI job; bump to 0.10.4
  * Add stryker.config.json with mutate targeting only source files,
excluding tests, e2e, and generated code. Add tsconfig.stryker.json
extending base tsconfig. Add stub.mutat.ts mutation test. Add
stryker npm script and Stryker CI job gating releases. Add
.stryker-tmp to .gitignore and ESLint ignores to prevent linting
Stryker's sandbox.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 8:12:00 PM

Commit [8216ee8923537af4849fee595662f255569b8681](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/8216ee8923537af4849fee595662f255569b8681)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: add mutation testing infrastructure and version stamping; bump to 0.10.3
  * Add Stryker mutation testing with vitest runner and *.mutat.ts test
pattern. Add vitest-mutat.config.ts for mutation test coverage.
Add make_ver.cjs to generate version.ts with git hash and build
timestamp. Add verify_version_bump.cjs for CI version validation.
Add generated_code/ directory to clean step. Exclude *.mutat.ts
from tsconfig and coverage configs. Update stub.ts docs to
reference mutat tests.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 6:13:03 PM

Commit [1d6310ab8447641a55ab42f176f863ed957152aa](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1d6310ab8447641a55ab42f176f863ed957152aa)

Author: `John Haugeland <stonecypher@gmail.com>`

  * dependencies for ci




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 6:04:29 PM

Commit [4472bddfec5752690508cdf4ceff862c37d37a38](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/4472bddfec5752690508cdf4ceff862c37d37a38)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: add release automation and version-bump verification; bump to 0.10.1
  * Add verify-version-bump and release jobs to CI workflow. Bump
actions/checkout and actions/setup-node to v5. Add postinstall
script for Playwright browser installation. Add auth token setup
note to base_README. Update tasklist with source maps completed
and issue tracker references for secret detection and provenance.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 5:45:02 PM

Commit [0f6c2dfd3a223a74d5b864e32c1c5b185b3cc860](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/0f6c2dfd3a223a74d5b864e32c1c5b185b3cc860)

Author: `John Haugeland <stonecypher@gmail.com>`

  * attempting to resolve playwright version issue in gh actions




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 5:21:32 PM

Commit [bf31e01cdb288064dda0d27e2a296e62c337f682](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/bf31e01cdb288064dda0d27e2a296e62c337f682)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: add cloc line counting with custom reporter; bump to 0.10.0
  * Add cloc to count lines of code by language, with and without tests.
Add custom cloc_report.cjs for colorized terminal output. Add
.clocignore for excluding generated files. Integrate cloc step into
build pipeline. Update tasklist with completed and declined items.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 4:38:03 PM

Commit [a7b5b5df2a49a4ec63b872806266bb594e55d4c8](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/a7b5b5df2a49a4ec63b872806266bb594e55d4c8)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: hide sidebar in visualization PNGs by appending CSS with !important; bump to 0.9.1
  * Prepending the sidebar hide rule lost to the existing display:flex
declaration later in the cascade. Append with !important instead so
it overrides regardless of source order.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 4:23:53 PM

Commit [1c9e629c4f7b650ee09131dedfd0ce1319be783f](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1c9e629c4f7b650ee09131dedfd0ce1319be783f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: add bundle visualization PNGs and html_to_png script; bump to 0.9.0
  * Add rollup-plugin-visualizer to generate sunburst, treemap, network,
and flamegraph HTML visualizations. Add html_to_png.js script using
Playwright to convert HTML to PNG screenshots. Add viz_png build step
that renders visualizations as PNGs and distributes to project root,
docs/, and docs/docs/ for use in README. Reorder build pipeline so
final TypeDoc run sees fresh PNGs. Move design spec from docs/ to
src/superpowers/spec/ to survive build clean.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 4:23:53 PM

Commit [7f65289967137294d05030571cf0a05cf4bc25b0](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/7f65289967137294d05030571cf0a05cf4bc25b0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: add bundle visualization PNGs and html_to_png script; bump to 0.9.0
  * Add rollup-plugin-visualizer to generate sunburst, treemap, network,
and flamegraph HTML visualizations. Add html_to_png.js script using
Playwright to convert HTML to PNG screenshots. Add viz_png build step
that renders visualizations as PNGs and distributes to project root,
docs/, and docs/docs/ for use in README. Reorder build pipeline so
final TypeDoc run sees fresh PNGs. Move design spec from docs/ to
src/superpowers/spec/ to survive build clean.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 3:33:08 PM

Commit [ce3005d2922fe11d239eb412d72a087922adcbc7](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/ce3005d2922fe11d239eb412d72a087922adcbc7)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs: add CONTRIBUTING.md, CODE_OF_CONDUCT.md, and design spec; bump to 0.8.1
  * Add cookbook-style CONTRIBUTING.md covering setup, adding functions,
testing (unit, stochastic, E2E), linting, building, documentation,
commit messages, and PR workflow. Add short CODE_OF_CONDUCT.md.
Add design spec for CONTRIBUTING.md. Update tasklist with declined
items using strikethrough notation and completed items.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 3:07:00 PM

Commit [e2389d9c208565b0560887fed41233976e30326a](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/e2389d9c208565b0560887fed41233976e30326a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: add commitlint, zod, and project tasklist; bump to 0.8.0
  * Add commitlint with conventional commits config for commit message
linting. Add zod for runtime type validation at boundaries. Add
project tasklist tracking future improvements. Exclude tasklist
from ESLint markdown linting due to non-standard checkbox notation.
Use strikethrough for declined tasklist items.




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 1:56:54 PM

Commit [38b26ec1d2df7d207e751eab2efe88f15a0f4ac8](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/38b26ec1d2df7d207e751eab2efe88f15a0f4ac8)

Author: `John Haugeland <stonecypher@gmail.com>`

  * Maximize TypeScript and ESLint strictness, add source maps to dist; bump to 0.7.0
  * TypeScript strictness:
- Add allowUnreachableCode: false to error on dead code
- Add allowUnusedLabels: false to error on unused labels
- Add isolatedDeclarations: true to require explicit type annotations
  on all exports, enabling parallel/tool-based .d.ts generation
- Add explicit void return types to unhandled_internal and
  unhandled_external stubs to satisfy isolatedDeclarations
  * ESLint strictness:
- Upgrade from tseslint.configs.recommended to strictTypeChecked +
  stylisticTypeChecked for type-aware linting (no-floating-promises,
  no-unsafe-assignment, prefer-nullish-coalescing, etc.)
- Scope type-checked configs to .ts files only; disable type checking
  for .js files
- Add projectService with allowDefaultProject for root config .ts files
- Add src/**/*.stoch.* to eslint ignores
- Fix playwright.config.ts: || to ?? per prefer-nullish-coalescing
  * Source maps:
- Add sourcemap: true to all three rollup output configs
- Add --source-map flags to terser to chain rollup maps through
  minification, producing .map files in dist/ that trace back to
  original TypeScript source
- Copy iife source map to docs alongside the bundle




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 1:56:54 PM

Commit [9bb53d6f2157fc1f500d0f0bfbcaf7a5c9e3b411](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/9bb53d6f2157fc1f500d0f0bfbcaf7a5c9e3b411)

Author: `John Haugeland <stonecypher@gmail.com>`

  * Maximize TypeScript and ESLint strictness, add source maps to dist; bump to 0.7.0
  * TypeScript strictness:
- Add allowUnreachableCode: false to error on dead code
- Add allowUnusedLabels: false to error on unused labels
- Add isolatedDeclarations: true to require explicit type annotations
  on all exports, enabling parallel/tool-based .d.ts generation
- Add explicit void return types to unhandled_internal and
  unhandled_external stubs to satisfy isolatedDeclarations
  * ESLint strictness:
- Upgrade from tseslint.configs.recommended to strictTypeChecked +
  stylisticTypeChecked for type-aware linting (no-floating-promises,
  no-unsafe-assignment, prefer-nullish-coalescing, etc.)
- Scope type-checked configs to .ts files only; disable type checking
  for .js files
- Add projectService with allowDefaultProject for root config .ts files
- Add src/**/*.stoch.* to eslint ignores
- Fix playwright.config.ts: || to ?? per prefer-nullish-coalescing
  * Source maps:
- Add sourcemap: true to all three rollup output configs
- Add --source-map flags to terser to chain rollup maps through
  minification, producing .map files in dist/ that trace back to
  original TypeScript source
- Copy iife source map to docs alongside the bundle




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 1:41:40 PM

Commit [e18a9a3a6db991056da0c7bda2aa637079290109](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/e18a9a3a6db991056da0c7bda2aa637079290109)

Author: `John Haugeland <stonecypher@gmail.com>`

  * Add .d.ts extraction, CJS type declarations, attw validation, and changelog generation; bump to 0.6.0
  * - Add "dts" build step to copy .d.ts and .d.ts.map files from build/ts/
  into dist/ so consumers can resolve TypeScript types from the package
- Add rollup-plugin-dts and rollup.ctsphase.config.js to generate
  index.d.cts for CJS require() consumers via a dedicated rollup pass
- Add package.json "exports" map with properly ordered conditions:
  "types" before "default" in both "import" and "require" blocks to
  avoid TypeScript's FallbackCondition bug
- Add @arethetypeswrong/cli (attw) to validate type resolution across
  node10, node16 (CJS/ESM), and bundler module strategies in CI
- Add better_git_changelog for automated CHANGELOG.md and
  CHANGELOG.long.md generation, copied into src/doc_md/
- Add CHANGELOG.md and CHANGELOG.long.md eslint ignores to prevent
  markdown/no-missing-label-refs errors on generated [Untagged] labels
- Simplify update_madlibs.js placeholder list by removing per-suite
  branch/func/line placeholders no longer used in base_README
- Wire dts, rollup-cts, attw, and changelog steps into the build
  pipeline




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 12:05:11 PM

Commit [82ee255248b39fc4ba673590672ff671842ff350](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/82ee255248b39fc4ba673590672ff671842ff350)

Author: `John Haugeland <stonecypher@gmail.com>`

  * minor readme improvements




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 11:45:41 AM

Commit [2a02078412384b11fdad36a3f410ccf769de2584](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/2a02078412384b11fdad36a3f410ccf769de2584)

Author: `John Haugeland <stonecypher@gmail.com>`

  * Add stochastic testing, typedoc coverage, and README coverage table; bump to 0.4.0
  * - Add stochastic (property-based) test infrastructure with fast-check,
  separate vitest config (vitest-stoch.config.ts), and stub.stoch.ts
- Add typedoc-plugin-coverage for documentation coverage tracking
- Add coverage table to base_README with unit, stochastic, and doc
  coverage breakdowns (statement, branch, func, line); use three
  separate td elements instead of colspan to work around TypeDoc HTML
  sanitization stripping colspan attributes
- Expand build pipeline: run typedoc before and after madlibs so README
  embeds are populated and doc coverage is available; reorder build
  steps accordingly
- Expand update_madlibs to parse sectioned test output and populate
  per-suite coverage and test count placeholders
- Expand run_tests_save to run both unit and stochastic suites and
  write section-labeled output
- Add docblock and type guard to double(); add unhandled_internal and
  unhandled_external stubs to demonstrate doc coverage behavior
- Exclude stoch and spec files from tsconfig and cross-suite coverage
- Add coverage-stoch to eslint ignores
- Add typescript-language-server dev dependency




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 11:45:41 AM

Commit [fc63d8c07df0d521cdb531b64b627bb8c1ae98bf](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/fc63d8c07df0d521cdb531b64b627bb8c1ae98bf)

Author: `John Haugeland <stonecypher@gmail.com>`

  * Add stochastic testing, typedoc coverage, and README coverage table; bump to 0.4.0
  * - Add stochastic (property-based) test infrastructure with fast-check,
  separate vitest config (vitest-stoch.config.ts), and stub.stoch.ts
- Add typedoc-plugin-coverage for documentation coverage tracking
- Add coverage table to base_README with unit, stochastic, and doc
  coverage breakdowns (statement, branch, func, line); use three
  separate td elements instead of colspan to work around TypeDoc HTML
  sanitization stripping colspan attributes
- Expand build pipeline: run typedoc before and after madlibs so README
  embeds are populated and doc coverage is available; reorder build
  steps accordingly
- Expand update_madlibs to parse sectioned test output and populate
  per-suite coverage and test count placeholders
- Expand run_tests_save to run both unit and stochastic suites and
  write section-labeled output
- Add docblock and type guard to double(); add unhandled_internal and
  unhandled_external stubs to demonstrate doc coverage behavior
- Exclude stoch and spec files from tsconfig and cross-suite coverage
- Add coverage-stoch to eslint ignores
- Add typescript-language-server dev dependency




&nbsp;

&nbsp;

## [Untagged] - Mar 29, 2026 8:45:09 AM

Commit [cb1204858713ec111b3a9c68604eb70d6262df4c](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/cb1204858713ec111b3a9c68604eb70d6262df4c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs/dist bug, update packages for threats, remove test-results from git repo




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:41:54 AM

Commit [688480395874eb33bdedfd95401e52fb30e32a7f](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/688480395874eb33bdedfd95401e52fb30e32a7f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * let's see if that node 20 warning is coming from lts/*




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:32:50 AM

Commit [1127b3c2019f1b607ae8956c9ce591b54a4997bc](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1127b3c2019f1b607ae8956c9ce591b54a4997bc)

Author: `John Haugeland <stonecypher@gmail.com>`

  * eliminate duplicate test run in build pipeline; bump to 0.2.0
  * update_madlibs was running `npm run just_test` internally to capture
coverage and test count, then the build script ran `just_test` again
as a separate step.  This ran the full test suite twice per build.
  * Fix: add run_tests_save.js which runs vitest once and writes the
output to build/test_output.txt.  update_madlibs now reads that file
instead of spawning its own test run.  Reorder the build pipeline to:
clean → just_test_save → update_madlibs → typescript → eslint →
rollup → terser → site → docs.
  * Also scope eslint globals.node to src/build_js/**/*.js so that
`process` is recognized in Node build scripts without leaking Node
globals into browser-side code.




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:22:00 AM

Commit [cea494f95ddfff097a554e18f679448a771197e6](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/cea494f95ddfff097a554e18f679448a771197e6)

Author: `John Haugeland <stonecypher@gmail.com>`

  * was accidentally running the tests in build, then again distinctly after




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:18:42 AM

Commit [16af19ae2b2e45f6f886fcae6f3ca8cf54ba3fd3](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/16af19ae2b2e45f6f886fcae6f3ca8cf54ba3fd3)

Author: `John Haugeland <stonecypher@gmail.com>`

  * is anything not a portability problem?  even date?  srsly




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:13:04 AM

Commit [5976e667a284cfff859a9e81bce422a30b667d3e](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/5976e667a284cfff859a9e81bce422a30b667d3e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * stray double and




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:08:18 AM

Commit [cda0bf54b8f8be022a555d74c9ce0dacc2d51f08](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/cda0bf54b8f8be022a555d74c9ce0dacc2d51f08)

Author: `John Haugeland <stonecypher@gmail.com>`

  * better label in gh action




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 11:07:14 AM

Commit [61e38c9bf828bc6dd58a68146645b77d664557a1](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/61e38c9bf828bc6dd58a68146645b77d664557a1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * oh, build residues are required




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 10:29:45 AM

Commit [01e787bd8e5aa7c4a23c23b925ec5d77253beb5a](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/01e787bd8e5aa7c4a23c23b925ec5d77253beb5a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci/cd and datestamps




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 10:27:50 AM

Commit [052b159ed9f00f696888b9406df4a8eb89c1b7a2](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/052b159ed9f00f696888b9406df4a8eb89c1b7a2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci/cd and datestamps




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 10:11:09 AM

Commit [cd1d52fd9804c9642260296e77d49398cf053851](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/cd1d52fd9804c9642260296e77d49398cf053851)

Author: `John Haugeland <stonecypher@gmail.com>`

  * add eslint, small bugs




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 9:56:41 AM

Commit [904c5757e884f0c0e013879f473ea01e3d4439d1](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/904c5757e884f0c0e013879f473ea01e3d4439d1)

Author: `John Haugeland <stonecypher@gmail.com>`

  * run eslint after ts so it doesn't waste time before real problems, but before everything else




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 9:50:34 AM

Commit [1aa12e667e9e64b025b9bf0f70b88aa870c18779](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/1aa12e667e9e64b025b9bf0f70b88aa870c18779)

Author: `John Haugeland <stonecypher@gmail.com>`

  * desiderata




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 8:24:47 AM

Commit [f11ff2278b0118a98e1d5dc8b564384dd8f4c18e](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/f11ff2278b0118a98e1d5dc8b564384dd8f4c18e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * better instructions, improved html, add favicon, finish removing cli, several bugfixes




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 8:04:55 AM

Commit [a8364371009bbaab65f89007083a955b0ed3f577](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/a8364371009bbaab65f89007083a955b0ed3f577)

Author: `John Haugeland <stonecypher@gmail.com>`

  * improve instructions, fix a few bugs, finish removing cli




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 7:45:00 AM

Commit [68049ea5b05a946f7a89bf7e279e02968cf2afba](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/68049ea5b05a946f7a89bf7e279e02968cf2afba)

Author: `John Haugeland <stonecypher@gmail.com>`

  * first try




&nbsp;

&nbsp;

## [Untagged] - Mar 20, 2026 7:21:01 AM

Commit [74c3b959ff458a041fcabf64863a76dac2fc928c](https://github.com/StoneCypher/react_ts_with_claude_gh_template/commit/74c3b959ff458a041fcabf64863a76dac2fc928c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * Initial commit