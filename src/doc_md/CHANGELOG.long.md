# Changelog

All notable changes to this project will be documented in this file.





&nbsp;

&nbsp;

Published tags:







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