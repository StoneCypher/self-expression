/**
 * Copy the emitted declaration files and their source maps from `build/ts` into `dist`.
 *
 * This exists because the `dts` npm script did the same work as a chain of POSIX `cp` and
 * `mkdir -p` calls. npm runs scripts through the platform shell, which on Windows is
 * cmd.exe, and cmd.exe has neither command — so `npm run build` died with "The syntax of
 * the command is incorrect" at the packaging stage. CI runs ubuntu-latest and never saw
 * it, which is how a build that cannot complete on a contributor's machine stayed green
 * for months. The same shape broke `update_madlibs`, whose tail was `cp README.md docs`.
 *
 * Node's own `fs` is the portable shell here: no dependency, no globbing rules that differ
 * per platform, and the copy either happens or throws with the path that failed.
 *
 * @see ./run_build.js — the stage runner that invokes this
 */

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join }                        from 'node:path';
import { fileURLToPath }                        from 'node:url';

/** Repository root, resolved from this file rather than from the working directory. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Subdirectories of `build/ts` whose declarations ship, `''` meaning the top level.
 *
 * Listed rather than discovered: `build/ts` also holds test output and internal modules
 * that are deliberately not part of the published surface, so walking it would ship more
 * than `package.json` promises.
 */
const AREAS = ['', 'charts', 'diagrams', 'raster'];

/**
 * Copy every `.d.ts` and `.d.ts.map` from one build area into the matching dist area.
 *
 * A missing source directory is a real failure and is allowed to throw: it means `tsc`
 * did not emit what this script was told to expect, and silently copying nothing would
 * produce a package whose types are absent rather than wrong — the harder bug to notice.
 *
 * @param area subdirectory under `build/ts`, or `''` for the top level
 * @returns how many files were copied, for the caller's summary line
 *
 * @example copyArea('charts');   // 12
 */
function copyArea(area) {

  const from = join(ROOT, 'build', 'ts', area),
        to   = join(ROOT, 'dist', area);

  mkdirSync(to, { recursive: true });

  const wanted = readdirSync(from)
    .filter(name => name.endsWith('.d.ts') || name.endsWith('.d.ts.map'));

  for (const name of wanted) { copyFileSync(join(from, name), join(to, name)); }

  return wanted.length;

}

let total = 0;
for (const area of AREAS) { total += copyArea(area); }
console.log(`dts: copied ${total} declaration files into dist/`);
