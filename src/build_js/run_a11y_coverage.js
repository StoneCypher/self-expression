/**
 * Stub a11y coverage runner for the template.
 *
 * This template ships no UI surface, so axe-style accessibility auditing
 * has nothing to measure here. The feature is wired into the build chain
 * via FEATURES so that template consumers (forks that DO add a UI) can
 * fill in the stub with their actual axe audit and turn the feature on.
 *
 * Template consumers should:
 *   1. Replace this script with a real axe-core (or pa11y, lighthouse, etc.)
 *      audit against their generated HTML — typically the docs/ site or a
 *      built UI bundle
 *   2. Write the result to build/a11y/coverage.json (or wherever they prefer)
 *   3. Flip `a11y_coverage: true` in build.config.json or build.config.local.json
 *
 * Default is OFF so a fresh clone doesn't get a confusing "stub ran" message
 * in every build.
 *
 * @example
 *   // Invoked by the `a11y_coverage` npm script (only when enabled):
 *   node src/build_js/run_a11y_coverage.js
 *   // Prints the stub-explanation message; exits 0
 */

console.log('a11y_coverage: stub — this template has no UI surface, so accessibility auditing');
console.log('              is not configured. Fork this template, add a UI, then replace');
console.log('              src/build_js/run_a11y_coverage.js with a real axe/pa11y/lighthouse');
console.log('              audit against your built output. Default is off; set');
console.log('              "a11y_coverage": true in build.config.json (or your local config)');
console.log('              once your audit is in place.');
