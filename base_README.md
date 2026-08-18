# react_ts_with_claude_gh_template v{{version}}

> Version {{version}} was built on {{built_text}} `{{built}}` from hash `{{gh_hash}}`.

TODO Put the project description here, please.

<!-- Supported embeds: {{built}} {{built_text}} {{coverage}} {{docblockcount}} {{doccoverage}} {{gh_hash}} {{stochbranch}} {{stochcoverage}} {{stochfunc}} {{stochline}} {{stochtestcount}} {{testcasecount}} {{unitbranch}} {{unitfunc}} {{unitline}} {{unittestcount}} {{version}} -->





&nbsp;

&nbsp;

## Test status

<table>
  <tr>
    <th></th>
    <th>Count</th>
    <th>Statement</th>
    <th>Branch</th>
    <th>Func</th>
    <th>Line</th>
  </tr>
  <tr>
    <th>Unit</th>
    <td>{{unittestcount}}</td>
    <td>{{coverage}}<small>%</small></td>
    <td>{{unitbranch}}<small>%</small></td>
    <td>{{unitfunc}}<small>%</small></td>
    <td>{{unitline}}<small>%</small></td>
  </tr>
  <tr>
    <th>Stochastic</th>
    <td>{{stochtestcount}}</td>
    <td>{{coverage}}<small>%</small></td>
    <td>{{stochbranch}}<small>%</small></td>
    <td>{{stochfunc}}<small>%</small></td>
    <td>{{stochline}}<small>%</small></td>
  </tr>
</table>

<table>
  <tr>
    <th></th>
    <th>Docblock count</th>
    <th>{{doccoverage}}<small>%</small></th>
  </tr>
  <tr>
    <th>Docblock coverage</th>
    <td>{{docblockcount}}</td>
    <td>{{doccoverage}}<small>%</small></td>
  </tr>
</table>

* [Site](https://stonecypher.github.io/react_ts_with_claude_gh_template/index.html)
* [Documentation](https://stonecypher.github.io/react_ts_with_claude_gh_template/docs/index.html)
* [Builds](https://www.github.com/stonecypher/react_ts_with_claude_gh_template/actions)
* [Source](https://www.github.com/stonecypher/react_ts_with_claude_gh_template/)

<img alt="star_chart" src="https://starchart.cc/StoneCypher/react_ts_with_claude_gh_template.svg" />





&nbsp;

&nbsp;

## How to use this template



&nbsp;

### Before invoking it

1. [ ] Decide whether to
    1. Update the deps in the template ***recommended***
    1. Update the deps post-install
    1. Let the deps be out of date



&nbsp;

### After invoking it

1. [ ] Reset package version
1. [ ] Turn Github Pages on, and point it at the `gh-pages` branch, `/ (root)` folder (CI creates the branch on the first push to `main`)
1. [ ] Turn on Dependabot alerts and security updates — these are repo settings and do not copy with the template (`.github/dependabot.yml` does).  Settings → Advanced Security, or:
   `gh api -X PUT repos/OWNER/REPO/vulnerability-alerts`
   `gh api -X PUT repos/OWNER/REPO/automated-security-fixes`
1. [ ] Set up the auth token `TODO_TOKEN_FOR_GH_CI_CD` after renaming it in ci.yml
1. [ ] Change all the `react_ts_with_claude_gh_template`s in this file's top block links
1. [ ] Change all the `react_ts_with_claude_gh_template`s in `package.json`
1. [ ] Change the `react_ts_with_claude_gh_template` in `verify_version_bump.js`
1. [ ] Write or copy-paste the description in `package.json`
1. [ ] Search for all remaining TODOs
1. [ ] Update meta tags and TODOs in `src/html/index.html`
1. [ ] Write a `base-README.md`
1. [ ] Change all the `react_ts_with_claude_gh_template`s in `rollup.config.js`
1. [ ] Decide whether to
    1. re-add a `bin` block to `package.json`, or
    2. remove the `bin` config from `rollup.config.js`
1. [ ] `npm install && npm run build`
    1. Maybe update the deps?
1. Handle the MAYBE-REMOVEs in the HTML HEAD
    1. [ ] Change src/html/index.html 's <title>
    1. [ ] Maybe replace src/html/favicon.png
1. [ ] commit and vroom





&nbsp;

&nbsp;

## Optional features (off by default)

To keep a fresh repo fast to install and cheap to run in CI, the heaviest tools
are **off by default**. Everything is controlled by `build.config.json` — both
the local build and CI read it, so enabling a feature is a one-line edit.

| Feature | Turn it on | Cost when on |
|---|---|---|
| **End-to-end tests** (Playwright) | set `features.e2e` to `true` | downloads Chromium on first run; only the dedicated Node-22 CI job installs a browser. Use Node 22 locally if the download stalls. |
| **Mutation testing** (Stryker) | set `ci.stryker` to `true` | a slow extra CI job on pushes to `main` |
| **Cross-platform CI** | add OSes to `ci.matrix.os` (e.g. `"windows-latest"`, `"macos-latest"`) | extra CI jobs — **Windows bills ×2 and macOS ×10** vs Linux |
| **Multi-Node CI** | add versions to `ci.matrix.node` (e.g. `24`) | one extra CI cell per added version |

Until you turn them on, CI is a single Ubuntu job with no browser, and every job
is time-capped so a hang can never burn hours.





&nbsp;

&nbsp;

## License

MIT
