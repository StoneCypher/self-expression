/**
 * Stub perf coverage runner for the template.
 *
 * This template ships no runtime hot path, so performance benchmarking
 * has nothing meaningful to measure here. The feature is wired into the
 * build chain via FEATURES so that template consumers (forks that DO
 * have a workload to benchmark) can fill in the stub with their actual
 * benchmark and turn the feature on.
 *
 * Template consumers should:
 *   1. Replace this script with a real benchmark (tinybench, benny,
 *      bundle-size measurement, cold-import timing, etc.) targeted at
 *      their library's hot path or shipping artifact
 *   2. Write the result to build/perf/coverage.json (or wherever they prefer)
 *   3. Flip `perf_coverage: true` in build.config.json or build.config.local.json
 *
 * Default is OFF so a fresh clone doesn't get a confusing "stub ran"
 * message in every build.
 *
 * @example
 *   // Invoked by the `perf_coverage` npm script (only when enabled):
 *   node src/build_js/run_perf_coverage.js
 *   // Prints the stub-explanation message; exits 0
 */

console.log('perf_coverage: stub — this template has no runtime hot path, so performance');
console.log('              benchmarking is not configured. Fork this template, add a workload,');
console.log('              then replace src/build_js/run_perf_coverage.js with a real benchmark');
console.log('              (tinybench, benny, bundle-size, cold-import timing, etc.) against');
console.log('              your library. Default is off; set "perf_coverage": true in');
console.log('              build.config.json (or your local config) once your benchmark is');
console.log('              in place.');
