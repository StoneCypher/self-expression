# Changelog

All notable changes to this project will be documented in this file.

90 merges; 9 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__8__0">0.8.0</a>, <a href="#0__6__2">0.6.2</a>, <a href="#0__6__1">0.6.1</a>, <a href="#0__6__0">0.6.0</a>, <a href="#0__5__0">0.5.0</a>, <a href="#0__4__0">0.4.0</a>, <a href="#0__3__0">0.3.0</a>, <a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 9:36:04 AM

Commit [8ca808cf36b167238ae674a2d77cdce6dce040cf](https://github.com/StoneCypher/self-expression/commit/8ca808cf36b167238ae674a2d77cdce6dce040cf)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: regenerate dist and README
  * dist/cli.cjs and its map rebuilt (tsc, rollup, terser) over the rebased source; claudio.cjs is byte-identical and unchanged. README.md regenerated from base_README.md for 0.9.0. The machine could not run the full suite, so the coverage and test-count embeds carry the 0.8.0 build's figures; the next full build refreshes them.




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 9:35:34 AM

Commit [70582f301d30d7cb5310bf0e8732ca1b06fc706b](https://github.com/StoneCypher/self-expression/commit/70582f301d30d7cb5310bf0e8732ca1b06fc706b)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(readme): restate the injected block's size after the skill grew in #128
  * The core conventions document gained the close-order section in #128, so the injected block now measures 37.7 KB (37,076 characters after frontmatter is stripped), not 33.5 KB. The token estimate scales with it.




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 9:31:55 AM

Commit [a35c189547ab87d485d0f87bd146ba7cb7c2553c](https://github.com/StoneCypher/self-expression/commit/a35c189547ab87d485d0f87bd146ba7cb7c2553c)

Author: `John Haugeland <stonecypher@gmail.com>`

  * chore(release): version 0.9.0




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 2:59:56 AM

Commit [cd82a58f1ed02e47c3e596508f49785df779019b](https://github.com/StoneCypher/self-expression/commit/cd82a58f1ed02e47c3e596508f49785df779019b)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(hooks): inject the core conventions at session start
  * The SessionStart hook now injects skills/self-expression/SKILL.md, frontmatter stripped, under a one-line framing, on startup, resume, clear and compact. The file is read at run time from the hook bundle's package root, never the cwd. An unreadable file injects nothing and logs to stderr. Unread notes to self still arrive, in the same additionalContext, notes first.
  * Adds inject.conventions (always, startup-only, off; default always). The handshake pointer names the injected heading unless injection is off, so a hooked host reads nothing twice and a hookless host is still told to read. Version 0.8.0.




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 9:30:50 AM

Commit [c76f1e292e9d4dc7582758b848f12c6b68430bbe](https://github.com/StoneCypher/self-expression/commit/c76f1e292e9d4dc7582758b848f12c6b68430bbe)

Author: `dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>`

  * build(deps): bump the minor-and-patch group across 1 directory with 10 updates
  * Bumps the minor-and-patch group with 10 updates in the / directory:
  * | Package | From | To |
| --- | --- | --- |
| [zod](https://github.com/colinhacks/zod) | `4.4.3` | `4.6.5` |
| [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/HEAD/@commitlint/config-conventional) | `21.2.2` | `21.2.3` |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | `26.3.0` | `26.6.2` |
| [commitlint](https://github.com/conventional-changelog/commitlint/tree/HEAD/@alias/commitlint) | `21.2.2` | `21.2.3` |
| [eslint](https://github.com/eslint/eslint) | `10.9.1` | `10.11.0` |
| [fast-check](https://github.com/dubzzz/fast-check/tree/HEAD/packages/fast-check) | `4.9.0` | `4.10.2` |
| [globals](https://github.com/sindresorhus/globals) | `17.11.0` | `17.12.0` |
| [rollup](https://github.com/rollup/rollup) | `4.62.5` | `4.63.4` |
| [terser](https://github.com/terser/terser) | `5.50.0` | `5.51.2` |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint/tree/HEAD/packages/typescript-eslint) | `8.68.0` | `8.70.0` |
  * 
  * Updates `zod` from 4.4.3 to 4.6.5
- [Release notes](https://github.com/colinhacks/zod/releases)
- [Commits](https://github.com/colinhacks/zod/compare/v4.4.3...v4.6.5)
  * Updates `@commitlint/config-conventional` from 21.2.2 to 21.2.3
- [Release notes](https://github.com/conventional-changelog/commitlint/releases)
- [Changelog](https://github.com/conventional-changelog/commitlint/blob/master/@commitlint/config-conventional/CHANGELOG.md)
- [Commits](https://github.com/conventional-changelog/commitlint/commits/v21.2.3/@commitlint/config-conventional)
  * Updates `@types/node` from 26.3.0 to 26.6.2
- [Release notes](https://github.com/DefinitelyTyped/DefinitelyTyped/releases)
- [Commits](https://github.com/DefinitelyTyped/DefinitelyTyped/commits/HEAD/types/node)
  * Updates `commitlint` from 21.2.2 to 21.2.3
- [Release notes](https://github.com/conventional-changelog/commitlint/releases)
- [Changelog](https://github.com/conventional-changelog/commitlint/blob/master/@alias/commitlint/CHANGELOG.md)
- [Commits](https://github.com/conventional-changelog/commitlint/commits/v21.2.3/@alias/commitlint)
  * Updates `eslint` from 10.9.1 to 10.11.0
- [Release notes](https://github.com/eslint/eslint/releases)
- [Commits](https://github.com/eslint/eslint/compare/v10.9.1...v10.11.0)
  * Updates `fast-check` from 4.9.0 to 4.10.2
- [Release notes](https://github.com/dubzzz/fast-check/releases)
- [Changelog](https://github.com/dubzzz/fast-check/blob/main/packages/fast-check/CHANGELOG.md)
- [Commits](https://github.com/dubzzz/fast-check/commits/v4.10.2/packages/fast-check)
  * Updates `globals` from 17.11.0 to 17.12.0
- [Release notes](https://github.com/sindresorhus/globals/releases)
- [Commits](https://github.com/sindresorhus/globals/compare/v17.11.0...v17.12.0)
  * Updates `rollup` from 4.62.5 to 4.63.4
- [Release notes](https://github.com/rollup/rollup/releases)
- [Changelog](https://github.com/rollup/rollup/blob/master/CHANGELOG.md)
- [Commits](https://github.com/rollup/rollup/compare/v4.62.5...v4.63.4)
  * Updates `terser` from 5.50.0 to 5.51.2
- [Changelog](https://github.com/terser/terser/blob/master/CHANGELOG.md)
- [Commits](https://github.com/terser/terser/compare/v5.50.0...v5.51.2)
  * Updates `typescript-eslint` from 8.68.0 to 8.70.0
- [Release notes](https://github.com/typescript-eslint/typescript-eslint/releases)
- [Changelog](https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/typescript-eslint/CHANGELOG.md)
- [Commits](https://github.com/typescript-eslint/typescript-eslint/commits/v8.70.0/packages/typescript-eslint)
  * ---
updated-dependencies:
- dependency-name: "@commitlint/config-conventional"
  dependency-version: 21.2.3
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: minor-and-patch
- dependency-name: "@types/node"
  dependency-version: 26.6.2
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: commitlint
  dependency-version: 21.2.3
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: minor-and-patch
- dependency-name: eslint
  dependency-version: 10.11.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: fast-check
  dependency-version: 4.10.2
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: globals
  dependency-version: 17.12.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: rollup
  dependency-version: 4.63.4
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: terser
  dependency-version: 5.51.2
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: typescript-eslint
  dependency-version: 8.70.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: zod
  dependency-version: 4.6.5
  dependency-type: direct:production
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
...
  * Signed-off-by: dependabot[bot] <support@github.com>




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 9:29:10 AM

Commit [bded679b7cc13177d767709206157ac89867cb25](https://github.com/StoneCypher/self-expression/commit/bded679b7cc13177d767709206157ac89867cb25)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: b88117c86dbc52a8f669faadae67481a5d40ad8d




&nbsp;

&nbsp;

<a name="0__8__0" />

## [0.8.0] - Sep 23, 2026 9:27:19 AM

Commit [b88117c86dbc52a8f669faadae67481a5d40ad8d](https://github.com/StoneCypher/self-expression/commit/b88117c86dbc52a8f669faadae67481a5d40ad8d)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: format enforcement at stop — visible signature line, list lint, express returns the line (v0.8.0) (#128)
  * * feat(express): return the rendered signature line to paste
  * A signature reply now ends with the exact visible line, rendered from the row just written, and says where it goes: first in the turn for an open, last for a close. The timestamp is the row's own clock. The delta arrow is shown only when the session already has an earlier signature, and when one exists but no delta was passed, the reply says so.
  * signature_line.ts holds both the renderer and the one-line recogniser, so the line express hands out and the line the Stop hook accepts come from the same code.
  * * feat(hooks): enforce the visible signature line and lint lists at stop
  * The Stop hook now checks what was rendered, not only what was recorded. Four checks run, each failing open on its own, and their verdicts merge into one output:
  * - close record (gate.signature): unchanged; blocks a turn with no recorded close
- close line (gate.signature_line, new, on): the last non-empty line must be the rendered signature line carrying the recorded text. Blocks, quoting the exact line to paste
- list lint (gate.lists, new, off|report|block, default report): parses the final message with mdast-util-from-markdown and inspects only prose list nodes outside blockquotes. Ordered lists of 2-10 items are violations and bullets are warnings. Report mode only logs
- open line (gate.open_line, new, on): the turn's first assistant text, read from the transcript tail, should begin with a rendered open matching a recorded one. It only ever warns, through systemMessage
  * Every finding lands in a new format_findings table (schema v8, an additive migration, pruned by retention.days), so the list lint's false-positive rate can be measured before it is switched to block. The turn-start context line gains a fixed 'format: sig-line, number-square lists, diff channels' segment. The CLI loads the parser with a dynamic import, so an install missing it skips the lint rather than failing to start.
  * * docs(readme): label the install snippet's code fence as bash
  * * docs(readme): label the generated README's install fence as bash too
  * Stage-1 eslint lints the committed README.md before madlibs regenerates it from base_README.md, so the base_README fix alone cannot get past the lint.
  * * fix(build): keep cloc output out of vitest's coverage directory
  * Stage 1 runs cloc in parallel with the test stage, and vitest's coverage run cleans coverage/ when it starts. When that clean landed between run_cloc.js writing coverage/cloc/report_*.json and cloc_report.cjs reading them, the build failed with ENOENT on a nondeterministic fraction of runs. The reports now go to build/cloc/, which only the pre-stage-1 clean step wipes and which build/* already gitignores.
  * Closes #126
  * * feat(hooks): format enforcement at stop, version 0.8.0
  * Minor bump for the format-enforcement feature: express returns the rendered signature line, the Stop hook checks the visible close line, warns on the open line, and lints lists (report-only by default), and the turn-start line carries a format reminder. Adds gate.lists, gate.signature_line and gate.open_line, and schema v8 (format_findings).
  * Regenerated tracked output from the full build: dist bundles (cli.cjs now loads mdast-util-from-markdown by dynamic import), README.md from base_README.md, and the changelogs.
  * * docs(skill): spell out the close order: body, then express, then only the line
  * Writing the line before recording it forces a sentence after the tool call, and that sentence becomes the message's last line. It showed up as a filler 'That close line is recorded as well' on every turn of a real session. The convention now states the order, bans narrating the recording, and says a reply to a refused stop is the express call and its line, nothing more.




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 2:59:56 AM

Commit [398f30eb01655d52368f160a30f381e610efc9c5](https://github.com/StoneCypher/self-expression/commit/398f30eb01655d52368f160a30f381e610efc9c5)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(hooks): inject the core conventions at session start
  * The SessionStart hook now injects skills/self-expression/SKILL.md, frontmatter stripped, under a one-line framing, on startup, resume, clear and compact. The file is read at run time from the hook bundle's package root, never the cwd. An unreadable file injects nothing and logs to stderr. Unread notes to self still arrive, in the same additionalContext, notes first.
  * Adds inject.conventions (always, startup-only, off; default always). The handshake pointer names the injected heading unless injection is off, so a hooked host reads nothing twice and a hookless host is still told to read. Version 0.8.0.




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 2:43:49 AM

Commit [f6ba30cc0947b4b83b49e1f2eb16a5d04d70d760](https://github.com/StoneCypher/self-expression/commit/f6ba30cc0947b4b83b49e1f2eb16a5d04d70d760)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skill): spell out the close order: body, then express, then only the line
  * Writing the line before recording it forces a sentence after the tool call, and that sentence becomes the message's last line. It showed up as a filler 'That close line is recorded as well' on every turn of a real session. The convention now states the order, bans narrating the recording, and says a reply to a refused stop is the express call and its line, nothing more.




&nbsp;

&nbsp;

## [Untagged] - Sep 23, 2026 1:56:59 AM

Commit [f545f5ddf1e0792db7de395ecfabafdd6bdc7b09](https://github.com/StoneCypher/self-expression/commit/f545f5ddf1e0792db7de395ecfabafdd6bdc7b09)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(hooks): format enforcement at stop, version 0.8.0
  * Minor bump for the format-enforcement feature: express returns the rendered signature line, the Stop hook checks the visible close line, warns on the open line, and lints lists (report-only by default), and the turn-start line carries a format reminder. Adds gate.lists, gate.signature_line and gate.open_line, and schema v8 (format_findings).
  * Regenerated tracked output from the full build: dist bundles (cli.cjs now loads mdast-util-from-markdown by dynamic import), README.md from base_README.md, and the changelogs.