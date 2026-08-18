# Lean-by-default template — opt-in heavy tooling

- **Date:** 2026-06-07
- **Status:** Proposed (design approved in brainstorming; pending spec review)
- **Branch:** `refactor_26-06-07_lean-by-default`

## Problem

This repository is a GitHub *template*: "Use this template" spawns new project
repos with batteries-included config. Two of those batteries — **Playwright**
(e2e + bundle visualizations) and **Stryker** (mutation testing) — are the
heaviest, and in practice are wanted *later* in a project's life, not at spawn
time. Today every spawned repo pays for them immediately:

- **Install-time browser tax.** `postinstall: npx playwright install --with-deps`
  eagerly downloads ~300 MB of browser engines on every `npm install`, whether
  or not the project uses a browser. This is also where a **Node 24 bug** stalls
  the Chromium headless-shell download indefinitely (observed: a single CI run
  burned ~2 hours before being cancelled by hand).
- **Shared CI minutes.** The author's GitHub Actions budget is **3000
  minutes/month across all projects**. Every spawned repo that runs Stryker + a
  3-OS matrix + browser installs on each main push draws from that shared pool.
  Runner billing is weighted: Linux ×1, Windows ×2, **macOS ×10**.
- **Single-repo constraint.** The author will not maintain multiple bootstrap
  templates (lean vs. full). One template must serve both "just starting" and
  "matured" projects.

The tension the author named: gating features behind config doesn't obviously
help, because the dominant cost is at *install* time (the browser download in
`postinstall`), which a build/CI flag wouldn't avoid.

## Key insight

The install-time cost is almost entirely the **eager browser download**, not the
npm packages. Decouple "scaffolded & available" from "heavy artifact fetched":
keep the dev-dependencies present (so scaffolding type-checks and enabling is a
one-line flip), but move the browser fetch out of `npm install` to **on-demand**
(only when an enabled browser feature actually runs). Then config-gating works,
and a fresh repo is lean.

A second decision compounds the win: **remove the bundle visualizations
entirely** (judged low-value). The visualization pipeline was one of only two
Chromium consumers; with it gone, the **only** remaining browser consumer is the
opt-in `e2e` feature. The default template becomes **100% browser-free** — no
Chromium for build or CI unless `e2e` is turned on.

## Goals

- A freshly-spawned repo installs fast (no browser download) and runs a single,
  cheap, browser-free CI job.
- Heavy features (e2e, mutation testing, multi-OS / multi-Node matrices) are
  **off by default** and enabled by editing one config file.
- No single CI run can burn more than a small, bounded number of billed minutes.
- One template repo; enabling a feature later is a one-line change.

## Non-goals

- Helper/enable CLI commands — decided against; plain `build.config.json` edit +
  README docs.
- Keeping the bundle visualizations — removed.
- Fixing the upstream Node-24 Playwright download bug — worked around by pinning
  the only browser job to Node 22.

## Design

### 1. Single source of truth: `build.config.json`

Extend the existing config (validated by `build.config.schema.json`); both the
build (`run_build.js`) and CI read it.

- `features`: keep `docs`, `eslint`, `cloc`, `changelog`, `terser`, `attw`,
  `site`. **Remove `viz_png`.** **Add `e2e`** (runs hosted_test/Playwright).
- Lean base default: `e2e: false`. The cheap, browser-free features
  (docs/site/changelog/cloc/terser/attw/eslint) stay on.
- New `ci` block:
  ```json
  "ci": {
    "matrix": { "os": ["ubuntu-latest"], "node": [24] },
    "stryker": false
  }
  ```
- Enabling a feature = edit one value (e.g. `"e2e": true`, or add
  `"windows-latest"` to `ci.matrix.os`).

### 2. Lean default posture

| | Default | Enable later |
|---|---|---|
| tsc, eslint, unit + stochastic tests, bundle (rollup/terser), `attw` | **ON** | — |
| docs / site / changelog / cloc (cheap, no browser) | **ON** | — |
| `e2e` (Playwright) | **OFF** | `features.e2e: true` → provisions Chromium on demand |
| `stryker` (mutation testing) | **OFF** | `ci.stryker: true` |
| multi-OS matrix (Windows ×2, macOS ×10) | **OFF** (ubuntu only) | add OSes to `ci.matrix.os` |
| multi-Node matrix | **OFF** (one Node) | add versions to `ci.matrix.node` |

A fresh repo's entire CI is **one ubuntu job** (~1–2 min, no browser) on both
PRs and main, until a flag is flipped.

### 3. Remove the visualizations

Delete the whole pipeline:
- `src/build_js/render_visualizations.js`
- `src/build_js/html_to_png.js` (confirmed: only the viz pipeline uses it)
- the `viz_png` npm script + the `viz_png` feature/profile entries
- committed `bundle_*.png` (root, `docs/`, `docs/docs/media/`)
- the README visualization block in `base_README.md`
- the **`rollup-plugin-visualizer`** devDependency + its `rollup.config` wiring
- update `update_madlibs.js` to stop referencing viz; update cloc/docs
  expectations accordingly

### 4. Install behavior

- **Remove the `postinstall` browser download** (no `postinstall` browser step
  at all). A fresh `npm install` pulls npm packages only.
- Playwright (`@playwright/test`, `playwright`) and Stryker stay in
  `devDependencies` (dormant) so the shipped `src/ts/e2e/*` and
  `stryker.config.json` keep resolving and type-checking.
- Remove the now-unneeded `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` plumbing and the
  "Cache Playwright browsers" CI steps that existed to serve the eager download
  (the default is browser-free; only the opt-in e2e job touches a browser).

### 5. On-demand Chromium — `ensure_chromium.js`

Repurpose the chromium-only install logic (currently `postinstall.js`):

- New file `src/build_js/ensure_chromium.js` exporting pure, testable units:
  `installWithRetry(runAttempt, attempts, log)` and a thin entry that installs
  **chromium only** with a per-attempt timeout (kills a stall) and retry (absorbs
  transient CDN flakiness).
- Before each retry, remove a stale Playwright `__dirlock` left by a killed
  attempt (observed failure mode in CI), so retries aren't self-sabotaged.
- Called by the e2e / `hosted_test` path **immediately before launching a
  browser, only when `features.e2e` is on** — never from `npm install`.
- In CI the e2e job runs under **Node 22** (dodges the Node-24 stall). Locally it
  uses the developer's Node; README notes "use Node 22 if the download stalls."
- Rename `src/ts/tests/postinstall.spec.ts` → `ensure_chromium.spec.ts`
  (same skip/retry control-flow tests; no real download).

### 6. CI structure (`.github/workflows/ci.yml`)

- **`config` job:** checks out, parses `build.config.json`, and reads the
  `#fullbuild` token from the head commit — **subsuming the former
  `detect-fullbuild` job** into one setup job. Emits outputs (`e2e`, `stryker`,
  `matrix-os`, `matrix-node`, `has-matrix`, `fullbuild`); other jobs gate on
  these.
- **PR:** one ubuntu lite job — tsc, eslint, unit+stoch, bundle, attw. Always.
  Browser-free.
- **main push:**
  - **ubuntu build** (always): full build minus opt-in features
    (docs/site/changelog/cloc/terser/attw + tests). Browser-free.
  - **e2e** (only if `config.e2e`): Node 22, calls `ensure_chromium`.
  - **stryker** (only if `config.stryker`).
  - **matrix** (only if `config` matrix lists more than the single default
    cell): runs the configured os/node cells *beyond* the default ubuntu/Node
    cell already verified by the main build, so the default cell is never
    re-run redundantly.
- Every job carries a budget cap (section 7).

### 7. Budget caps (folded from PR #46)

| Job | Runner | Cap | Worst-case billed |
|---|---|---|---|
| config (parse + #fullbuild) | ubuntu | 3 | 3 |
| PR lite | ubuntu | 6 | 6 |
| main build | ubuntu | 15 | 15 |
| e2e (opt-in) | ubuntu | 12 | 12 |
| matrix · ubuntu | ubuntu | 10 | 10 |
| matrix · windows | windows ×2 | 8 | 16 |
| matrix · macOS | macOS ×10 | 5 | 50 |
| stryker (opt-in) | ubuntu | 30 | 30 |
| verify-version-bump | ubuntu | 5 | 5 |
| release | ubuntu | 8 | 8 |

GitHub's default job timeout is 360 minutes; capping **every** job makes that
unreachable. Because the heavy jobs are opt-in, a typical spawned repo's CI is
just the lite job — its realistic per-run cost is a couple of billed minutes,
and the absolute worst case (everything enabled, every job hangs to its cap) is
bounded to ~150 billed minutes.

### 8. Enable UX

Edit `build.config.json`. A README "Turning features on" section documents each
flag and what it costs (browser download for e2e, billed-minute multipliers for
the matrix).

## Files

- **Added:** `src/build_js/ensure_chromium.js`,
  `src/ts/tests/ensure_chromium.spec.ts`
- **Modified:** `build.config.json`, `build.config.schema.json`, `package.json`
  (drop postinstall browser download, drop `viz_png` script, drop
  `rollup-plugin-visualizer`), `rollup.config.*`, `src/build_js/run_build.js`,
  `src/build_js/update_madlibs.js`, `base_README.md`,
  `.github/workflows/ci.yml`, README/docs
- **Removed:** `src/build_js/render_visualizations.js`,
  `src/build_js/html_to_png.js`, `src/build_js/postinstall.js` (→ renamed),
  `src/ts/tests/postinstall.spec.ts` (→ renamed), `bundle_*.png` (+ docs copies)

## Testing

- **Unit:** `ensure_chromium` skip decision + retry control flow (pure logic,
  injected runner — no real download).
- **Config:** `build_config_schema` accepts the new `e2e` feature and `ci` block;
  rejects unknown keys/types (extends existing `build_config.spec.ts`).
- **Build smoke:** default profile builds **browser-free** and produces the
  expected artifacts; turning `e2e` on routes through `ensure_chromium` (mocked
  in unit context).
- All tests stay inside `npm run build` (project rule). No fake tests.

## Risks / open items

- **`#fullbuild` escape hatch** interaction with the config-driven matrix needs
  care (it should force the configured matrix/heavy jobs on a PR).
- **Node-24 bug is upstream**; Node 22 is the workaround for the e2e job only —
  revisit when fixed upstream.
- Removing `rollup-plugin-visualizer` must not break the rollup build (verify
  config has no other consumer).
- Version bump: this is a substantive change; a bump happens via `/sc-commit` at
  commit time, not in this spec.
