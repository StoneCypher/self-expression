# Changelog

All notable changes to this project will be documented in this file.

1 merge; Changelogging the last 10 commits; Full changelog at [CHANGELOG.long.md](CHANGELOG.long.md)



&nbsp;

&nbsp;

Published tags:







&nbsp;

&nbsp;

## [Untagged] - Jul 15, 2026 9:10:16 PM

Commit [e163bbd6dc7a6a165d56bd2bed06a73d9e51a59d](https://github.com/StoneCypher/self-expression/commit/e163bbd6dc7a6a165d56bd2bed06a73d9e51a59d)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(ci): publish docs via gh-pages, enable Dependabot, roll CI back to Node 22
  * - Roll every CI job from Node 24 back to Node 22 (Node 24 stalls the
  Playwright browser download); build.config.json matrix default is now [22]
- Publish the built site to a gh-pages branch instead of serving main:/docs:
  test-main-full uploads docs/ as an artifact on pushes, and a new
  publish-docs job pushes its contents to gh-pages (force_orphan) with
  peaceiris/actions-gh-pages. URLs are unchanged since Pages served docs/
  as site root before.
- Untrack docs/ (29 built files) and gitignore it; local builds still
  generate it and hosted_test still serves it
- Add .github/dependabot.yml: weekly npm and github-actions version
  updates, npm minor+patch grouped into one PR. Repo-side Dependabot
  alerts and automated security fixes were enabled via the API.
- README/base_README: Pages checklist item now points at gh-pages/root,
  new checklist item for the Dependabot repo settings (which do not copy
  with the template), multi-Node example version updated
- Bump version to 0.22.0
  * Claude-Session: https://claude.ai/code/session_018z7gLexTcPCDQbBV4e7TL8




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 5:03:50 PM

Commit [bc7521ebfa626af9e468f4c461cf16387b0f9316](https://github.com/StoneCypher/self-expression/commit/bc7521ebfa626af9e468f4c461cf16387b0f9316)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat: lean-by-default template with opt-in heavy tools; bump to 0.21.0
  * Make a freshly-spawned repo install fast and run cheap CI by default, with
the heavy tools one flag away. build.config.json is the single source of
truth that both the build and CI read.
  * - Remove the bundle visualizations entirely (renderer, html_to_png,
  committed PNGs, rollup-plugin-visualizer, README block).
- Stop the eager postinstall Playwright browser download; provision Chromium
  on-demand (ensure_chromium, with retry + per-attempt timeout + stale-lock
  cleanup) only for the opt-in e2e suite.
- Add an `e2e` feature flag and a `ci` block (matrix os/node, stryker), all
  off by default; pin e2e off in the build profiles so enabling it can't pull
  a browser into the other jobs.
- Rewrite CI: a `config` job parses build.config.json (+ #fullbuild) and gates
  the jobs; a fresh repo runs one browser-free Ubuntu job, while e2e (Node 22),
  stryker, and the OS/Node matrix appear only when enabled.
- Cap every CI job's timeout-minutes (macOS tightest given its x10 billing) so
  no run can burn toward GitHub's 360-minute default.
- Document how to turn each feature on, with its cost.
  * The default template is now 100% browser-free; Chromium installs only when
e2e is enabled.




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 4:59:59 PM

Commit [7d54ef738aa87691e7fe44280fef7020128d672e](https://github.com/StoneCypher/self-expression/commit/7d54ef738aa87691e7fe44280fef7020128d672e)

Author: `John Haugeland <stonecypher@gmail.com>`

  * docs: document how to enable e2e, stryker, and CI matrices




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 4:59:14 PM

Commit [07ccfae93860b19441046c2797c537c57fffb1c8](https://github.com/StoneCypher/self-expression/commit/07ccfae93860b19441046c2797c537c57fffb1c8)

Author: `John Haugeland <stonecypher@gmail.com>`

  * ci: drive jobs from build.config.json; browser-free default; cap every job; Node 22 e2e




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 4:51:23 PM

Commit [1b69611a59376ec41f126c20e7004f45c90fdf9a](https://github.com/StoneCypher/self-expression/commit/1b69611a59376ec41f126c20e7004f45c90fdf9a)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): run e2e stage only when features.e2e is enabled
  * Add hosted_test npm script that invokes src/build_js/hosted_test.js.
The e2e stage (stage 6, script hosted_test) is gated via the FEATURES
catalog defaultEnabled: false entry — bucketByStage only schedules it
when features.e2e === true, so the default build never launches a browser.




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 4:49:51 PM

Commit [6216f4508093ebc117465ec9504a28bea7c70b8f](https://github.com/StoneCypher/self-expression/commit/6216f4508093ebc117465ec9504a28bea7c70b8f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * feat(build): add e2e feature flag and ci config block
  * Add `e2e` as an opt-in optional feature (defaultEnabled: false) at stage 6,
backed by the `hosted_test` script. Add a `ci` top-level block to the schema
(matrix.os, matrix.node, stryker) for CI to consume in a later phase. Update
build.config.json and build.config.schema.json to match; fix disabled-list
filter to exclude off-by-default features that simply remain off.




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 4:44:53 PM

Commit [66515788585f56d52764c05e9a9def7245869c35](https://github.com/StoneCypher/self-expression/commit/66515788585f56d52764c05e9a9def7245869c35)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: drop eager postinstall browser download; provision Chromium on-demand for e2e
  * - Remove "postinstall": "node src/build_js/postinstall.js" from package.json
  so a fresh npm install never downloads a browser
- Wire ensure_chromium into hosted_test.js: import main as ensureChromium
  and call it just before execSync('npx playwright test ...'), so Chromium
  is provisioned only when the e2e suite actually runs




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 4:35:20 PM

Commit [a3e5e12fe7f5f1573923ff01e9c17f215b0e6dc7](https://github.com/StoneCypher/self-expression/commit/a3e5e12fe7f5f1573923ff01e9c17f215b0e6dc7)

Author: `John Haugeland <stonecypher@gmail.com>`

  * refactor: rename postinstall.js -> ensure_chromium.js with stale-lock cleanup
  * - git mv postinstall.js -> ensure_chromium.js and postinstall.spec.ts ->
  ensure_chromium.spec.ts
- Update module docblock: no longer a postinstall hook; now an on-demand
  helper invoked by the e2e harness before launching a browser
- Add clearStaleLock() export: removes Playwright __dirlock left by a
  SIGKILL'd attempt so retries aren't blocked
- Call clearStaleLock() at the top of each installWithRetry loop iteration
- Add unit tests for clearStaleLock (unset path, missing dir)




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 12:31:11 PM

Commit [643e97e668ee0226f227c07acf2e3ec8e647356f](https://github.com/StoneCypher/self-expression/commit/643e97e668ee0226f227c07acf2e3ec8e647356f)

Author: `John Haugeland <stonecypher@gmail.com>`

  * refactor: remove viz_png feature from build, config, and README
  * Remove viz_png from FEATURES catalog (build_config_schema.js), from all
profiles and the top-level features block in build.config.json and
build.config.schema.json, and drop the viz_png npm script from package.json.
Update build_config.spec.ts to remove all viz_png assertions (stage 3 now
contains only terser; --only=eslint no longer lists viz_png as disabled).
Delete the bundle PNG visualization <table> from base_README.md.
  * Full build passes; stage 3 runs terser only, no Chromium launched.
Regenerated artifacts (README.md, CHANGELOG, docs, coverage-stoch) committed.




&nbsp;

&nbsp;

## [Untagged] - Jun 8, 2026 12:26:34 PM

Commit [e2eaf9c0400998445ddf64821c45be98bc7e5637](https://github.com/StoneCypher/self-expression/commit/e2eaf9c0400998445ddf64821c45be98bc7e5637)

Author: `John Haugeland <stonecypher@gmail.com>`

  * build: drop rollup-plugin-visualizer (visualizations removed)
  * Remove the import and all four visualizer({...}) plugin entries from
rollup.config.js, delete the package.json devDependency, and refresh
package-lock.json. Rollup verified passing after the change.