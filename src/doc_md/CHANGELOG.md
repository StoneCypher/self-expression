# Changelog

All notable changes to this project will be documented in this file.

90 merges; 8 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__6__2">0.6.2</a>, <a href="#0__6__1">0.6.1</a>, <a href="#0__6__0">0.6.0</a>, <a href="#0__5__0">0.5.0</a>, <a href="#0__4__0">0.4.0</a>, <a href="#0__3__0">0.3.0</a>, <a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Sep 22, 2026 2:04:14 PM

Commit [3521d24bd366b68b2bb1409cfba7faf8b60fdee7](https://github.com/StoneCypher/self-expression/commit/3521d24bd366b68b2bb1409cfba7faf8b60fdee7)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix(build): keep cloc output out of vitest's coverage directory
  * Stage 1 runs cloc in parallel with the test stage, and vitest's coverage run cleans coverage/ when it starts. When that clean landed between run_cloc.js writing coverage/cloc/report_*.json and cloc_report.cjs reading them, the build failed with ENOENT on a nondeterministic fraction of runs. The reports now go to build/cloc/, which only the pre-stage-1 clean step wipes and which build/* already gitignores.
  * Closes #126




&nbsp;

&nbsp;

## [Untagged] - Sep 22, 2026 1:56:39 PM

Commit [d7928774ac95df5960db03191175f4c5d9bb8d47](https://github.com/StoneCypher/self-expression/commit/d7928774ac95df5960db03191175f4c5d9bb8d47)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(readme): label the generated README's install fence as bash too
  * Stage-1 eslint lints the committed README.md before madlibs regenerates it from base_README.md, so the base_README fix alone cannot get past the lint.




&nbsp;

&nbsp;

## [Untagged] - Sep 22, 2026 1:54:41 PM

Commit [4ed11b91d4a1da5590ff89d76df27dcc396ee0c5](https://github.com/StoneCypher/self-expression/commit/4ed11b91d4a1da5590ff89d76df27dcc396ee0c5)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(readme): label the install snippet's code fence as bash




&nbsp;

&nbsp;

## [Untagged] - Sep 22, 2026 1:44:11 PM

Commit [df09babe4df6977f10715a6fc0bb5f0c0c0bb76e](https://github.com/StoneCypher/self-expression/commit/df09babe4df6977f10715a6fc0bb5f0c0c0bb76e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(hooks): enforce the visible signature line and lint lists at stop
  * The Stop hook now checks what was rendered, not only what was recorded. Four checks run, each failing open on its own, and their verdicts merge into one output:
  * - close record (gate.signature): unchanged; blocks a turn with no recorded close
- close line (gate.signature_line, new, on): the last non-empty line must be the rendered signature line carrying the recorded text. Blocks, quoting the exact line to paste
- list lint (gate.lists, new, off|report|block, default report): parses the final message with mdast-util-from-markdown and inspects only prose list nodes outside blockquotes. Ordered lists of 2-10 items are violations and bullets are warnings. Report mode only logs
- open line (gate.open_line, new, on): the turn's first assistant text, read from the transcript tail, should begin with a rendered open matching a recorded one. It only ever warns, through systemMessage
  * Every finding lands in a new format_findings table (schema v8, an additive migration, pruned by retention.days), so the list lint's false-positive rate can be measured before it is switched to block. The turn-start context line gains a fixed 'format: sig-line, number-square lists, diff channels' segment. The CLI loads the parser with a dynamic import, so an install missing it skips the lint rather than failing to start.




&nbsp;

&nbsp;

## [Untagged] - Sep 22, 2026 1:44:00 PM

Commit [19860a68c48ddcef452a48f4bfc8a6e8baab5b44](https://github.com/StoneCypher/self-expression/commit/19860a68c48ddcef452a48f4bfc8a6e8baab5b44)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(express): return the rendered signature line to paste
  * A signature reply now ends with the exact visible line, rendered from the row just written, and says where it goes: first in the turn for an open, last for a close. The timestamp is the row's own clock. The delta arrow is shown only when the session already has an earlier signature, and when one exists but no delta was passed, the reply says so.
  * signature_line.ts holds both the renderer and the one-line recogniser, so the line express hands out and the line the Stop hook accepts come from the same code.




&nbsp;

&nbsp;

## [Untagged] - Sep 21, 2026 6:44:59 PM

Commit [bea6768f92940f671368423e018f0b7a4ae5e66b](https://github.com/StoneCypher/self-expression/commit/bea6768f92940f671368423e018f0b7a4ae5e66b)

Author: `dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>`

  * build(deps): bump the minor-and-patch group across 1 directory with 8 updates
  * Bumps the minor-and-patch group with 8 updates in the / directory:
  * | Package | From | To |
| --- | --- | --- |
| [zod](https://github.com/colinhacks/zod) | `4.4.3` | `4.6.5` |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | `26.3.0` | `26.6.2` |
| [eslint](https://github.com/eslint/eslint) | `10.9.1` | `10.11.0` |
| [fast-check](https://github.com/dubzzz/fast-check/tree/HEAD/packages/fast-check) | `4.9.0` | `4.10.1` |
| [globals](https://github.com/sindresorhus/globals) | `17.11.0` | `17.12.0` |
| [rollup](https://github.com/rollup/rollup) | `4.62.5` | `4.63.3` |
| [terser](https://github.com/terser/terser) | `5.50.0` | `5.51.2` |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint/tree/HEAD/packages/typescript-eslint) | `8.68.0` | `8.70.0` |
  * 
  * Updates `zod` from 4.4.3 to 4.6.5
- [Release notes](https://github.com/colinhacks/zod/releases)
- [Commits](https://github.com/colinhacks/zod/compare/v4.4.3...v4.6.5)
  * Updates `@types/node` from 26.3.0 to 26.6.2
- [Release notes](https://github.com/DefinitelyTyped/DefinitelyTyped/releases)
- [Commits](https://github.com/DefinitelyTyped/DefinitelyTyped/commits/HEAD/types/node)
  * Updates `eslint` from 10.9.1 to 10.11.0
- [Release notes](https://github.com/eslint/eslint/releases)
- [Commits](https://github.com/eslint/eslint/compare/v10.9.1...v10.11.0)
  * Updates `fast-check` from 4.9.0 to 4.10.1
- [Release notes](https://github.com/dubzzz/fast-check/releases)
- [Changelog](https://github.com/dubzzz/fast-check/blob/main/packages/fast-check/CHANGELOG.md)
- [Commits](https://github.com/dubzzz/fast-check/commits/v4.10.1/packages/fast-check)
  * Updates `globals` from 17.11.0 to 17.12.0
- [Release notes](https://github.com/sindresorhus/globals/releases)
- [Commits](https://github.com/sindresorhus/globals/compare/v17.11.0...v17.12.0)
  * Updates `rollup` from 4.62.5 to 4.63.3
- [Release notes](https://github.com/rollup/rollup/releases)
- [Changelog](https://github.com/rollup/rollup/blob/master/CHANGELOG.md)
- [Commits](https://github.com/rollup/rollup/compare/v4.62.5...v4.63.3)
  * Updates `terser` from 5.50.0 to 5.51.2
- [Changelog](https://github.com/terser/terser/blob/master/CHANGELOG.md)
- [Commits](https://github.com/terser/terser/compare/v5.50.0...v5.51.2)
  * Updates `typescript-eslint` from 8.68.0 to 8.70.0
- [Release notes](https://github.com/typescript-eslint/typescript-eslint/releases)
- [Changelog](https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/typescript-eslint/CHANGELOG.md)
- [Commits](https://github.com/typescript-eslint/typescript-eslint/commits/v8.70.0/packages/typescript-eslint)
  * ---
updated-dependencies:
- dependency-name: "@types/node"
  dependency-version: 26.5.1
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: eslint
  dependency-version: 10.10.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: fast-check
  dependency-version: 4.10.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: globals
  dependency-version: 17.12.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: rollup
  dependency-version: 4.63.1
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
  dependency-version: 4.6.2
  dependency-type: direct:production
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
...
  * Signed-off-by: dependabot[bot] <support@github.com>




&nbsp;

&nbsp;

## [Untagged] - Sep 20, 2026 10:46:22 PM

Commit [859fd45a3c17c86e3a6bddb5cbf86498ab5bf9b8](https://github.com/StoneCypher/self-expression/commit/859fd45a3c17c86e3a6bddb5cbf86498ab5bf9b8)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix(hooks): the Stop gate stops asking for the message to be restated, version 0.7.1 (#123)
  * The block's reason ended with:
  *   Then restate your previous final message IN FULL, because a blocked stop
  can hide it from the user entirely.
  * That premise does not hold on Claude Code. The assistant's message, the block,
and the compliance all render in sequence, so nothing was hidden — and the
instruction reliably produced a visible, verbatim duplicate of a response the
user had already read.
  * The effect compounds with the gate's own trigger condition. A turn that signs
off correctly never blocks, so the restatement only ever fires on turns that
were already going slightly wrong; the gate's loudest and most frequent visible
effect was repeating the turn it had just interrupted. Observed across a long
session before anyone traced the echo back to this string.
  * The instruction is not wrong in general. On a host where a blocked stop really
does suppress the response, restating is the correct and necessary behaviour.
It failed here by encoding an assumption about one host as an unconditional
directive, and never being rechecked when that assumption stopped holding.
  * Replaced with the opposite instruction, stated plainly, so a model reading the
block does not reach for the restatement out of habit.
  * Pinned by a test asserting the reason matches neither /restate your previous/i
nor /IN FULL/, with the reasoning recorded beside it. 91 tests in
hooks.spec.ts, all passing.
  * dist/ is deliberately untouched: a fresh rollup on main emits a cli.cjs that
requires ./cli_commands.js and cannot load, which is what
fix_26-09-16_windows-bin-externals is addressing. Rebuilding the bundle here
would ship that separate breakage inside an unrelated fix.




&nbsp;

&nbsp;

## [Untagged] - Sep 20, 2026 10:38:22 PM

Commit [2ba98c74193310eb0a9e4d132c206e7d12cfa56a](https://github.com/StoneCypher/self-expression/commit/2ba98c74193310eb0a9e4d132c206e7d12cfa56a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix(hooks): the Stop gate stops asking for the message to be restated, version 0.7.1
  * The block's reason ended with:
  *   Then restate your previous final message IN FULL, because a blocked stop
  can hide it from the user entirely.
  * That premise does not hold on Claude Code. The assistant's message, the block,
and the compliance all render in sequence, so nothing was hidden — and the
instruction reliably produced a visible, verbatim duplicate of a response the
user had already read.
  * The effect compounds with the gate's own trigger condition. A turn that signs
off correctly never blocks, so the restatement only ever fires on turns that
were already going slightly wrong; the gate's loudest and most frequent visible
effect was repeating the turn it had just interrupted. Observed across a long
session before anyone traced the echo back to this string.
  * The instruction is not wrong in general. On a host where a blocked stop really
does suppress the response, restating is the correct and necessary behaviour.
It failed here by encoding an assumption about one host as an unconditional
directive, and never being rechecked when that assumption stopped holding.
  * Replaced with the opposite instruction, stated plainly, so a model reading the
block does not reach for the restatement out of habit.
  * Pinned by a test asserting the reason matches neither /restate your previous/i
nor /IN FULL/, with the reasoning recorded beside it. 91 tests in
hooks.spec.ts, all passing.
  * dist/ is deliberately untouched: a fresh rollup on main emits a cli.cjs that
requires ./cli_commands.js and cannot load, which is what
fix_26-09-16_windows-bin-externals is addressing. Rebuilding the bundle here
would ship that separate breakage inside an unrelated fix.




&nbsp;

&nbsp;

## [Untagged] - Sep 20, 2026 10:42:11 PM

Commit [d8587e0a1f928811578d967525b5e3889d3903c0](https://github.com/StoneCypher/self-expression/commit/d8587e0a1f928811578d967525b5e3889d3903c0)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix: Windows bin bundles never bundled, and the build gate was date-bombed (#121)
  * * fix(build): bundle own code into the bin builds on Windows
  * The `external` predicate shared by the cli and claudio bin configs recognised an
absolute id by a leading '/'. Rollup calls that predicate with already-resolved
ids, and on Windows a resolved id is a drive-letter path — C:\...\cli_commands.js
— which begins with neither '.' nor '/'. Every one of the project's own modules
was therefore read as a bare specifier and left external, so the emitted binaries
required './cli_commands.js' and './mcp/*': files the bundle was supposed to
contain and that no build step ever writes. Both bins failed to load at all, with
MODULE_NOT_FOUND on the first require.
  * Replaces the leading-slash test with node:path's isAbsolute, which recognises
drive-letter and UNC paths as well as POSIX ones.
  * dist/cli.cjs and dist/claudio.cjs are regenerated here as well, because the
copies currently committed are that broken Windows output and do not run.
  * The defect is invisible on POSIX, where resolved ids do start with '/', so CI on
ubuntu-latest could not have caught it; only a Windows build shows it.
  * * test(notes): unpin note_tools specs from a fixed calendar date
  * note_tools.spec.ts wrote its notes through the clock-injected path at a literal
2026-08-28, then read several of them back through the MCP handlers, which take
no clock and derive state against the real present. Once the default TTL elapsed
past that date in the real world every note read back as 'expired', and nine
specs began failing on the calendar rather than on a change to any code. The
build gate has been red since, unnoticed, because the only workflow runs on main
are Dependabot jobs that never run the build.
  * NOW is now a small fixed offset behind the real present, so the written-to-read
relationship these specs actually assert about holds indefinitely.
  * Also documents the handler-layer clock asymmetry on note_tools.ts, including what
to do should those handlers ever grow a `when` parameter.
  * * docs(readme): state that the plugin, not the bare server, is the install
  * The README carried no installation section at all, so "install the MCP" reads as
an instruction to register .mcp.json and stop there. That yields a host holding
twenty-eight tools and none of the conventions those tools assume, and it fails
silently rather than loudly: the model reconstructs the conventions from whatever
is in reach — this repository's own source, given the chance — and arrives
somewhere reasonable slowly, having spent a great many tokens rediscovering a
document that ships in the box.
  * Adds an Installation section covering the plugin install, why the servers alone
are not enough, a direct note to agents reading the file, and the requirement to
remove predecessor personal-config skills first so affect and checklist rows are
not logged twice into two databases.
  * Written into base_README.md, which README.md is generated from.
  * * fix(mcp): launch the servers directly rather than through npx
  * Both servers were declared as `npx -y self-expression mcp`, which asks the
registry for a package that is not published, and pays npx resolution cost on
every server start even in the case where it does resolve. Locally it only worked
at all because the package had been `npm link`ed.
  * Replaces both with a direct node invocation of the bundled bins beneath
${CLAUDE_PLUGIN_ROOT} — the directory the plugin is installed into, which already
contains dist/. That drops the registry dependency, the npm link requirement when
developing, and the per-start npx overhead.
  * .codex-plugin/plugin.json points its own mcpServers at this same file, and
${CLAUDE_PLUGIN_ROOT} is a Claude Code variable. Codex is not regressed here — it
could not resolve the unpublished package either — but the two hosts will need
separate declarations, or a published package, before both work. gemini-extension.json
already carries its own inline copy and is untouched.




&nbsp;

&nbsp;

## [Untagged] - Sep 20, 2026 10:38:22 PM

Commit [c42f1352bd45a63d57ec88d56762ca18f9e776d2](https://github.com/StoneCypher/self-expression/commit/c42f1352bd45a63d57ec88d56762ca18f9e776d2)

Author: `John Haugeland <stonecypher@gmail.com>`

  * fix(hooks): the Stop gate stops asking for the message to be restated, version 0.7.1
  * The block's reason ended with:
  *   Then restate your previous final message IN FULL, because a blocked stop
  can hide it from the user entirely.
  * That premise does not hold on Claude Code. The assistant's message, the block,
and the compliance all render in sequence, so nothing was hidden — and the
instruction reliably produced a visible, verbatim duplicate of a response the
user had already read.
  * The effect compounds with the gate's own trigger condition. A turn that signs
off correctly never blocks, so the restatement only ever fires on turns that
were already going slightly wrong; the gate's loudest and most frequent visible
effect was repeating the turn it had just interrupted. Observed across a long
session before anyone traced the echo back to this string.
  * The instruction is not wrong in general. On a host where a blocked stop really
does suppress the response, restating is the correct and necessary behaviour.
It failed here by encoding an assumption about one host as an unconditional
directive, and never being rechecked when that assumption stopped holding.
  * Replaced with the opposite instruction, stated plainly, so a model reading the
block does not reach for the restatement out of habit.
  * Pinned by a test asserting the reason matches neither /restate your previous/i
nor /IN FULL/, with the reasoning recorded beside it. 91 tests in
hooks.spec.ts, all passing.
  * dist/ is deliberately untouched: a fresh rollup on main emits a cli.cjs that
requires ./cli_commands.js and cannot load, which is what
fix_26-09-16_windows-bin-externals is addressing. Rebuilding the bundle here
would ship that separate breakage inside an unrelated fix.