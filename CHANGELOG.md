# Changelog

All notable changes to this project will be documented in this file.

14 merges; 2 releases; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:

<a href="#0__2__1">0.2.1</a>, <a href="#0__2__0">0.2.0</a>





&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 10:28:40 PM

Commit [255cf481c4988793229e1dfcf7373bacf9c12e50](https://github.com/StoneCypher/self-expression/commit/255cf481c4988793229e1dfcf7373bacf9c12e50)

Author: `StoneCypher <StoneCypher@users.noreply.github.com>`

  * deploy: e5322892a9deaa97f02ffbd2d38386d550430c4e




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 10:27:52 PM

Commit [e5322892a9deaa97f02ffbd2d38386d550430c4e](https://github.com/StoneCypher/self-expression/commit/e5322892a9deaa97f02ffbd2d38386d550430c4e)

Author: `John Haugeland <stonecypher@gmail.com>`

Merges [7285d21, 36b85d4]

  * Merge pull request #47 from StoneCypher/feat_26-08-27_ascii-renderers_26
  * feat: implement the visuals vocabulary as ASCII/emoji renderers (#26)




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 8:23:17 PM

Commit [36b85d49bcf9461b61fde5ceedb341c0e50ef6bb](https://github.com/StoneCypher/self-expression/commit/36b85d49bcf9461b61fde5ceedb341c0e50ef6bb)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: implement the visuals vocabulary as ASCII/emoji renderers (#26)
  * Implement every visual form in the vendored status-checklist vocabulary as
pure TypeScript renderers plus six grouped MCP tools.
  * - Six grouped MCP chart tools (render_series, render_bar, render_rows,
  render_timeline, render_glyph, render_checklist_summary) backed by pure,
  synchronous renderers in src/ts/charts (scale, markers, series, bars,
  rows, timeline, glyphs, checklist), each exported directly from the
  library as well.
- README Charts section documenting the six tools and the renderer exports.
- Strikethrough sarcasm-device carve-out in the self-expression SKILL: the
  one device that renders inline rather than inside a code block.
- eslint now ignores the .superpowers/** scratch dir, which was hanging the
  linter.
- stryker mutate narrowed to src/ts/charts/**/*.ts so opt-in mutation runs
  stay fast.
- Doc code-fence lint fixes: language-tagged fenced blocks in the reference
  and plan docs, and escaped [0,100] intervals that markdown misread as
  label references.
- Build: dts step now also copies the charts declaration subtree into
  dist/charts so the ESM types entry resolves (fixes an attw internal
  resolution error).
  * Closes #26




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 6:45:14 PM

Commit [6bff4f02ad547c36ada0e82894837a69c70ff498](https://github.com/StoneCypher/self-expression/commit/6bff4f02ad547c36ada0e82894837a69c70ff498)

Author: `dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>`

  * chore(deps-dev): bump the minor-and-patch group with 3 updates
  * Bumps the minor-and-patch group with 3 updates: [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node), [eslint](https://github.com/eslint/eslint) and [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint/tree/HEAD/packages/typescript-eslint).
  * 
Updates `@types/node` from 26.2.0 to 26.3.0
- [Release notes](https://github.com/DefinitelyTyped/DefinitelyTyped/releases)
- [Commits](https://github.com/DefinitelyTyped/DefinitelyTyped/commits/HEAD/types/node)
  * Updates `eslint` from 10.9.0 to 10.9.1
- [Release notes](https://github.com/eslint/eslint/releases)
- [Commits](https://github.com/eslint/eslint/compare/v10.9.0...v10.9.1)
  * Updates `typescript-eslint` from 8.67.0 to 8.68.0
- [Release notes](https://github.com/typescript-eslint/typescript-eslint/releases)
- [Changelog](https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/typescript-eslint/CHANGELOG.md)
- [Commits](https://github.com/typescript-eslint/typescript-eslint/commits/v8.68.0/packages/typescript-eslint)
  * ---
updated-dependencies:
- dependency-name: "@types/node"
  dependency-version: 26.3.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
- dependency-name: eslint
  dependency-version: 10.9.1
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: minor-and-patch
- dependency-name: typescript-eslint
  dependency-version: 8.68.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: minor-and-patch
...
  * Signed-off-by: dependabot[bot] <support@github.com>




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 3:22:02 PM

Commit [b6136b93d3c23ac706c81ecf31bd2c8219ef9fe7](https://github.com/StoneCypher/self-expression/commit/b6136b93d3c23ac706c81ecf31bd2c8219ef9fe7)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skills): typographic latitude for super/subscripts; the tiny voice joins the sarcasm devices




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 3:19:43 PM

Commit [2c186a8f33c172e87061770007cf866d446c9c0e](https://github.com/StoneCypher/self-expression/commit/2c186a8f33c172e87061770007cf866d446c9c0e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skills): grant the full sarcasm arsenal — deadpan footnotes with dagger variants, mock commits, weaponized precision, dawning-horror ellipsis




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 3:18:27 PM

Commit [00a8b7aeda32ff346d024df9ce69465e3328fc06](https://github.com/StoneCypher/self-expression/commit/00a8b7aeda32ff346d024df9ce69465e3328fc06)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skills): sarcasm devices wear code blocks — spongebob case and sanitized strikethrough




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 3:03:30 PM

Commit [f91c35c5f06eca1fa58a5b618bc59a9c9c23e984](https://github.com/StoneCypher/self-expression/commit/f91c35c5f06eca1fa58a5b618bc59a9c9c23e984)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skills): migrate skip valve and idea-line fine print; grant sPoNgEbOb latitude




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 2:56:53 PM

Commit [7b044a7ef5848733e96a49e70f82955e5752261a](https://github.com/StoneCypher/self-expression/commit/7b044a7ef5848733e96a49e70f82955e5752261a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skills): signature context may carry one or two non-face emoji




&nbsp;

&nbsp;

## [Untagged] - Aug 27, 2026 2:54:41 PM

Commit [395e6c0ea13211402e6d58ed046b53c2e8b8a78e](https://github.com/StoneCypher/self-expression/commit/395e6c0ea13211402e6d58ed046b53c2e8b8a78e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs(skills): bless database/network/cleanup activity glyphs