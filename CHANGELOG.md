# Changelog

All notable changes to this project will be documented in this file.

Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



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