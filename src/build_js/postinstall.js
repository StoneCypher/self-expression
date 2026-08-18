/**
 * postinstall hook: install only the Playwright browser this project uses.
 *
 * The project drives Chromium exclusively — visualization screenshots
 * (`render_visualizations.js` / `html_to_png.js` both `import { chromium }`)
 * and the e2e suite, whose `playwright.config.ts` declares no `projects` so
 * Playwright defaults to Chromium. Firefox and WebKit are never used.
 *
 * The previous hook ran `npx playwright install --with-deps` (all engines) on
 * every `npm install`. That is wasteful, and in CI it has stalled
 * indefinitely *after* Chromium downloads while reaching for the next engine,
 * hanging the whole job. This script fixes both problems:
 *
 *   - installs ONLY chromium (with its OS deps);
 *   - time-boxes each attempt so a stalled download is killed, not waited on;
 *   - retries a few times to absorb transient CDN flakiness;
 *   - skips entirely when `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, for CI jobs
 *     that need no browser at all (the ci-lite PR check, the verification
 *     matrix, the version-bump check).
 *
 * @example
 *   // Normal install — downloads Chromium with OS deps:
 *   node src/build_js/postinstall.js
 *
 * @example
 *   // Skip the browser download (browserless CI jobs):
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node src/build_js/postinstall.js
 *   // logs the skip and exits 0 without contacting the network
 *
 * @see render_visualizations.js
 * @see ../../playwright.config.ts
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

/** Per-attempt time box for one browser install (4 minutes, in ms). */
export const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

/** Number of install attempts before giving up. */
export const DEFAULT_ATTEMPTS = 3;

/**
 * Whether the Playwright browser install should be skipped.
 *
 * Skipping is opt-in via the exact string `"1"` so an accidental empty or
 * `"0"` value never silently disables browser provisioning.
 *
 * @param env - the environment to read `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` from
 * @returns whether the caller asked to skip the download
 *
 * @example
 *   shouldSkipBrowserInstall({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }) // => true
 *   shouldSkipBrowserInstall({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0' }) // => false
 *   shouldSkipBrowserInstall({})                                        // => false
 */
export function shouldSkipBrowserInstall(env) {
  return (env ?? {}).PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1';
}

/**
 * Run an install attempt repeatedly until one succeeds.
 *
 * Each attempt is delegated to `runAttempt`; if it throws — including the
 * timeout kill that turns a hang into an error — the next attempt runs, up to
 * `attempts` total. The error from the final attempt is rethrown so the caller
 * can fail the install.
 *
 * @param runAttempt - performs one attempt (receives the 1-based attempt number); throws on failure
 * @param attempts - maximum number of attempts; must be >= 1
 * @param log - sink for retry diagnostics (defaults to console.error)
 * @returns the 1-based number of the attempt that succeeded
 *
 * @throws {Error} the last error when every attempt fails
 *
 * @example
 *   let n = 0;
 *   installWithRetry(() => { if (++n < 2) throw new Error('stall'); }, 3, () => {});
 *   // => 2  (first attempt throws, second succeeds)
 */
export function installWithRetry(runAttempt, attempts = DEFAULT_ATTEMPTS, log = console.error) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      runAttempt(attempt);
      return attempt;
    } catch (err) {
      lastError = err;
      log(`Playwright Chromium install attempt ${attempt}/${attempts} failed: ${err.message}`);
    }
  }
  throw lastError;
}

/**
 * Perform one real, time-boxed `playwright install` for Chromium.
 *
 * @param timeoutMs - kill the attempt if it exceeds this many milliseconds
 * @throws {Error} if the command exits non-zero or exceeds the timeout
 */
function runChromiumInstall(timeoutMs) {
  execSync('npx playwright install --with-deps chromium', {
    stdio: 'inherit',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
}

/**
 * Entry point: skip when requested, otherwise install Chromium with retries.
 *
 * Dependency-injected so tests can exercise the skip/install branch without
 * touching the network.
 *
 * @param env - environment to read the skip flag from (defaults to process.env)
 * @param install - performs the (retried) install; defaults to a real Chromium install
 * @returns whether an install was attempted (false when skipped)
 *
 * @example
 *   main({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, () => {}) // => false (skipped)
 */
export function main(
  env = process.env,
  install = () => installWithRetry(() => runChromiumInstall(DEFAULT_TIMEOUT_MS)),
) {
  if (shouldSkipBrowserInstall(env)) {
    console.log('postinstall: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — skipping browser install.');
    return false;
  }
  install();
  return true;
}

// Run only when invoked directly, never when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`postinstall: Chromium install failed after retries: ${err.message}`);
    process.exit(1);
  }
}
