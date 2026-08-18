# Lean-by-default template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the template lean by default — remove the bundle visualizations, stop the eager Playwright browser download, and gate e2e / stryker / multi-OS / multi-Node behind `build.config.json` flags that both the build and CI read — so a freshly-spawned repo is browser-free and runs one cheap CI job, with every CI job time-capped.

**Architecture:** `build.config.json` is the single source of truth. The build (`run_build.js`) and CI (`ci.yml`) both read it. Heavy features default off; Chromium is provisioned on-demand (only for opt-in `e2e`) via `ensure_chromium.js` under Node 22 in CI.

**Tech Stack:** Node/TypeScript, Vitest, Rollup, Playwright (dormant), Stryker (dormant), GitHub Actions, zod (config schema).

**Spec:** `src/superpowers/spec/2026-06-07-lean-by-default-design.md`

---

## Phase 1 — Remove the bundle visualizations

### Task 1: Delete the visualization pipeline files and the committed PNGs

**Files:**
- Remove: `src/build_js/render_visualizations.js`
- Remove: `src/build_js/html_to_png.js`
- Remove: `bundle_sunburst.png`, `bundle_treemap.png`, `bundle_network.png`, `bundle_flamegraph.png` (repo root)
- Remove: `docs/bundle_*.png`, `docs/docs/media/bundle_*.png`

- [ ] **Step 1:** Confirm nothing else imports these. Run: `grep -rn "html_to_png\|render_visualizations" src package.json .github` — expect matches only in `package.json` (the `viz_png` script) and `run_build.js` (handled in Task 3).
- [ ] **Step 2:** `git rm src/build_js/render_visualizations.js src/build_js/html_to_png.js`
- [ ] **Step 3:** `git rm bundle_sunburst.png bundle_treemap.png bundle_network.png bundle_flamegraph.png`
- [ ] **Step 4:** `git rm docs/bundle_network.png docs/docs/media/bundle_network.png` (and any other committed `bundle_*.png` copies that `git ls-files "**/bundle_*.png"` reports)
- [ ] **Step 5:** Commit: `git commit -m "refactor: remove bundle visualization renderer and committed PNGs"`

### Task 2: Drop rollup-plugin-visualizer

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `rollup.config.*` (remove the visualizer plugin import + usage)
- Modify: `package-lock.json` (via npm)

- [ ] **Step 1:** In `rollup.config.*`, remove the `import ... from 'rollup-plugin-visualizer'` line and any `visualizer({...})` entry in the `plugins` array(s). Run `grep -rn "visualizer" rollup.config.*` to find them.
- [ ] **Step 2:** Remove `"rollup-plugin-visualizer": "^7.0.1"` from `package.json` devDependencies.
- [ ] **Step 3:** `npm install` to update `package-lock.json`.
- [ ] **Step 4:** Verify rollup still runs: `npm run rollup` — expect success, no visualizer output.
- [ ] **Step 5:** Commit: `git commit -m "build: drop rollup-plugin-visualizer (visualizations removed)"`

### Task 3: Remove viz_png from build config, scripts, build chain, and README

**Files:**
- Modify: `build.config.json` (remove `viz_png` from `features` and every `profiles.*.features`)
- Modify: `build.config.schema.json` (remove `viz_png` from the feature enum/object)
- Modify: `package.json` (remove the `viz_png` script; remove `viz_png` from any composite script)
- Modify: `src/build_js/run_build.js` (remove the stage that runs `viz_png`)
- Modify: `src/build_js/update_madlibs.js` (remove any viz reference)
- Modify: `base_README.md` (remove the `<table>` visualization block referencing `bundle_*.png`)
- Test: `src/ts/tests/build_config.spec.ts` (remove/adjust any assertion referencing `viz_png`)

- [ ] **Step 1:** Find every reference: `grep -rn "viz_png" src build.config.json build.config.schema.json package.json base_README.md`
- [ ] **Step 2:** Remove each reference per the file list above. In `run_build.js`, drop `viz_png` from its stage's script list (it currently shares a stage with `terser`); keep `terser`.
- [ ] **Step 3:** In `base_README.md`, delete the visualization `<table>`/`<img src="bundle_*.png">` block.
- [ ] **Step 4:** Run the full build: `npm run build` — expect green, no viz stage, no Chromium launched, README generated without the viz block.
- [ ] **Step 5:** Run IDE diagnostics on changed files; expect clean.
- [ ] **Step 6:** Commit: `git commit -m "refactor: remove viz_png feature from build, config, and README"`

---

## Phase 2 — On-demand Chromium (ensure_chromium)

### Task 4: Rename postinstall.js → ensure_chromium.js with __dirlock cleanup

**Files:**
- Rename: `src/build_js/postinstall.js` → `src/build_js/ensure_chromium.js`
- Rename: `src/ts/tests/postinstall.spec.ts` → `src/ts/tests/ensure_chromium.spec.ts`

- [ ] **Step 1:** `git mv src/build_js/postinstall.js src/build_js/ensure_chromium.js` and `git mv src/ts/tests/postinstall.spec.ts src/ts/tests/ensure_chromium.spec.ts`
- [ ] **Step 2:** Update the spec's import path to `../../build_js/ensure_chromium.js`.
- [ ] **Step 3:** In `ensure_chromium.js`, before each install attempt remove a stale lock so a killed attempt doesn't poison the retry. Add a helper and call it inside `installWithRetry`'s loop body before `runAttempt`:

```js
import { rmSync } from 'fs';
import { join } from 'path';

/**
 * Remove a stale Playwright `__dirlock` left by a SIGKILL'd install attempt.
 * @param browsersPath - the PLAYWRIGHT_BROWSERS_PATH dir (defaults to env)
 */
export function clearStaleLock(browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH) {
  if (!browsersPath) return;
  try { rmSync(join(browsersPath, '__dirlock'), { force: true, recursive: true }); } catch { /* nothing to clear */ }
}
```

In `installWithRetry`, call `clearStaleLock()` at the top of each iteration before `runAttempt(attempt)`.
- [ ] **Step 4:** Update the module docblock: it is now an on-demand helper invoked by the e2e path, not a postinstall hook.
- [ ] **Step 5:** Add a unit test for `clearStaleLock` (no throw when path unset / missing) in `ensure_chromium.spec.ts`:

```ts
it('clearStaleLock tolerates an unset or missing path', () => {
  expect(() => clearStaleLock(undefined)).not.toThrow();
  expect(() => clearStaleLock('/no/such/dir/xyz')).not.toThrow();
});
```

- [ ] **Step 6:** Run tests: `npm run just_test_save` — expect all pass.
- [ ] **Step 7:** Run IDE diagnostics; expect clean.
- [ ] **Step 8:** Commit: `git commit -m "refactor: postinstall.js -> ensure_chromium.js (on-demand, dirlock cleanup)"`

### Task 5: Remove the eager postinstall browser download; wire ensure_chromium into the e2e path

**Files:**
- Modify: `package.json` (remove the `postinstall` script entirely)
- Modify: `src/build_js/hosted_test.js` (call ensure_chromium before launching e2e)
- Modify: `.github/workflows/ci.yml` (remove `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` env + the "Cache Playwright browsers" steps that served the eager download — handled fully in Phase 4; here just delete the `postinstall`)

- [ ] **Step 1:** Delete the `"postinstall": "node src/build_js/ensure_chromium.js"` line from `package.json` scripts.
- [ ] **Step 2:** In `hosted_test.js`, before the `execSync('npx playwright test ...')` call, ensure Chromium is present by importing and calling the ensure_chromium entry (run only when e2e is being executed):

```js
import { main as ensureChromium } from './ensure_chromium.js';
// ... before running playwright tests:
ensureChromium();
```

- [ ] **Step 3:** Run `npm install` to confirm no postinstall browser download happens (fast, no Chromium fetch).
- [ ] **Step 4:** Commit: `git commit -m "build: drop eager postinstall browser download; provision Chromium on-demand for e2e"`

---

## Phase 3 — Config: e2e feature + ci block

### Task 6: Add `e2e` feature and `ci` block to schema + config

**Files:**
- Modify: `build.config.schema.json` (or `src/build_js/build_config_schema.js` — whichever holds the zod schema)
- Modify: `build.config.json`
- Test: `src/ts/tests/build_config.spec.ts`

- [ ] **Step 1 (test first):** In `build_config.spec.ts`, add failing tests:

```ts
it('accepts the e2e feature flag', () => {
  const parsed = BuildConfigSchema.parse({ features: { e2e: true } });
  expect(parsed.features?.e2e).toBe(true);
});

it('accepts a ci block with matrix and stryker', () => {
  const parsed = BuildConfigSchema.parse({
    ci: { matrix: { os: ['ubuntu-latest'], node: [24] }, stryker: false },
  });
  expect(parsed.ci?.stryker).toBe(false);
  expect(parsed.ci?.matrix?.os).toContain('ubuntu-latest');
});
```

- [ ] **Step 2:** Run: `npx vitest run src/ts/tests/build_config.spec.ts` — expect FAIL (unknown keys `e2e` / `ci`).
- [ ] **Step 3:** Add `e2e` to the feature schema (boolean, optional) and a `ci` object schema `{ matrix: { os: string[], node: number[] }, stryker: boolean }` to the zod schema. Keep "reject unknown keys" behavior intact.
- [ ] **Step 4:** In `build.config.json`: add `"e2e": false` to `features`; add the `ci` block `{ "matrix": { "os": ["ubuntu-latest"], "node": [24] }, "stryker": false }`.
- [ ] **Step 5:** Run the tests again — expect PASS.
- [ ] **Step 6:** Commit: `git commit -m "feat(build): add e2e feature flag and ci config block"`

### Task 7: Gate the e2e build step on `features.e2e` in run_build.js

**Files:**
- Modify: `src/build_js/run_build.js`

- [ ] **Step 1:** Wire an `e2e` stage that runs `hosted_test` only when the resolved config has `features.e2e === true`. Follow the existing pattern `run_build.js` uses for other optional features (e.g. how `docs`/`eslint` are conditionally included).
- [ ] **Step 2:** Run `npm run build` with `e2e: false` (default) — expect no e2e/browser activity.
- [ ] **Step 3:** Temporarily set `features.e2e: true` locally and run `npm run build` — expect ensure_chromium to provision Chromium and e2e tests to run; then revert the flag.
- [ ] **Step 4:** Commit: `git commit -m "feat(build): run e2e stage only when features.e2e is enabled"`

---

## Phase 4 — CI driven by the config

### Task 8: Rewrite ci.yml — config job, lite PR, gated main jobs, caps, Node 22 e2e

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1:** Replace `detect-fullbuild` with a `config` job that (a) parses `build.config.json` (a `bash`/`node -e` step reading `ci.stryker`, `ci.matrix.os`, `ci.matrix.node`, `features.e2e`) and (b) reads the `#fullbuild` token. Emit outputs: `e2e`, `stryker`, `matrix_os` (JSON array), `matrix_node` (JSON array), `has_matrix`, `fullbuild`. Give it `timeout-minutes: 3`.
- [ ] **Step 2:** Keep `test-pr` (PR lite) as-is but drop the `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` env and the "Cache Playwright browsers" step (no eager download anymore). `timeout-minutes: 6`.
- [ ] **Step 3:** `test-main-full` (push or fullbuild): drop the Playwright cache + skip env; `timeout-minutes: 15`. Browser-free now (viz removed).
- [ ] **Step 4:** Add an `e2e` job gated on `needs.config.outputs.e2e == 'true'`, `runs-on: ubuntu-latest`, **`node-version: 22`**, `timeout-minutes: 12`; runs `npm install` then `npm run build` with e2e on (ensure_chromium provisions Chromium).
- [ ] **Step 5:** `stryker` job gated on `needs.config.outputs.stryker == 'true'`; `timeout-minutes: 30`.
- [ ] **Step 6:** `test-main-matrix` gated on `needs.config.outputs.has_matrix == 'true'`, with `matrix: { include: <from config outputs> }`; per-cell `timeout-minutes: ${{ matrix.timeout }}` (ubuntu 10, windows 8, macOS 5 — derive timeouts or default 10/8/5 by os in the config step).
- [ ] **Step 7:** `verify-version-bump`: `timeout-minutes: 5`; drop the Playwright cache/skip plumbing. `release`: `timeout-minutes: 8`; update its `needs` to the renamed/added jobs.
- [ ] **Step 8:** Validate YAML via IDE diagnostics (expect only the pre-existing `TAG` warnings).
- [ ] **Step 9:** Commit: `git commit -m "ci: drive jobs from build.config.json; cap every job; Node 22 for e2e"`

---

## Phase 5 — Docs

### Task 9: Document "turning features on" in base_README.md

**Files:**
- Modify: `base_README.md`

- [ ] **Step 1:** Add a short section listing each flag, what it costs, and the one-line edit:
  - `features.e2e: true` → enables Playwright e2e (downloads Chromium on first run; use Node 22 if it stalls).
  - `ci.stryker: true` → enables mutation testing in CI.
  - add OSes to `ci.matrix.os` / versions to `ci.matrix.node` → cross-platform / multi-Node CI (note Windows ×2, macOS ×10 billed-minute cost).
- [ ] **Step 2:** Run `npm run build` to regenerate `README.md` from `base_README.md`.
- [ ] **Step 3:** Commit: `git commit -m "docs: document how to enable e2e, stryker, and matrices"`

---

## Phase 6 — Land

### Task 10: Version bump, full build, and land the PR

- [ ] **Step 1:** Run `/sc-commit` (bumps version per substance, runs the full build, commits regenerated artifacts) — or bump `package.json` + `package-lock.json` and rebuild manually.
- [ ] **Step 2:** Confirm the full build is green and browser-free by default.
- [ ] **Step 3:** Push the branch; open a PR against `main` summarizing the redesign; supersede/close PR #46 (its caps are folded in here).
- [ ] **Step 4:** Wait for the PR's lite check to pass.
- [ ] **Step 5:** Squash-merge into `main` (no branch deletion). Confirm the post-merge main run is bounded and browser-free.

---

## Self-review notes

- **Spec coverage:** §1 config → Tasks 6–7; §2 posture → Tasks 6–8; §3 remove viz → Tasks 1–3; §4 install → Tasks 4–5; §5 ensure_chromium → Task 4; §6 CI → Task 8; §7 caps → Task 8 (folds PR #46); §8 enable UX → Task 9. Covered.
- **Open item (#fullbuild):** the `config` job still emits `fullbuild`; `test-main-*` jobs keep their `|| fullbuild == 'true'` gate so `#fullbuild` forces the heavy jobs on a PR.
- **Naming consistency:** the on-demand entry is `main()` exported from `ensure_chromium.js` (was `postinstall.js`); the e2e path imports it as `ensureChromium`.
