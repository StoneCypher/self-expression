/**
 * Run license-checker against the project's dependencies and write a
 * JSON report to build/license/coverage.json. The build/ directory is
 * wiped by clean.js between builds, so no extra cleanup is needed.
 *
 * Scans both production and development dependencies because this is a
 * library template — devDeps reflect the build/test toolchain that ships
 * the package, and consumers may want visibility into all license types
 * before forking.
 *
 * @example
 *   // Invoked by the `license_check` npm script:
 *   node src/build_js/run_license_check.js
 *   // Produces build/license/coverage.json with shape:
 *   //   { "package@version": { licenses: "MIT", repository: ..., ... }, ... }
 */

import checker from 'license-checker';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');
const outDir = join(projectRoot, 'build', 'license');
const outPath = join(outDir, 'coverage.json');

function runChecker() {
  return new Promise((resolve, reject) => {
    checker.init(
      { start: projectRoot, production: false, development: true },
      (err, packages) => {
        if (err) reject(err);
        else resolve(packages);
      }
    );
  });
}

async function main() {
  const packages = await runChecker();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(packages, null, 2), 'utf8');
  const pkgCount = Object.keys(packages).length;
  const licenseSet = new Set();
  for (const p of Object.values(packages)) {
    if (Array.isArray(p.licenses)) p.licenses.forEach(l => licenseSet.add(l));
    else if (p.licenses) licenseSet.add(p.licenses);
  }
  console.log(`license_check: scanned ${pkgCount} packages, ${licenseSet.size} unique licenses -> ${outPath}`);
}

main().catch(err => {
  console.error(`license_check failed: ${err.message}`);
  process.exit(1);
});
