/**
 * Where the strike ledger and the vendored leitmotif assets live.
 *
 * The ledger rides the same data directory as the expression log — one
 * `SELF_EXPRESSION_HOME` relocates both — but in its **own database file**, so the
 * audio facility remains auditable installed alone and a broken ledger can never
 * take the expression log down with it.
 *
 * @see ../channels/paths.js
 * @see ./ledger.js
 */

import { homedir } from 'node:os';
import { join }    from 'node:path';
import { dataDir } from '../channels/paths.js';

/** Filename of the strike ledger inside the shared data directory. */
export const AUDIO_DB_FILE = 'audio.sqlite3';

/** Directory name, under the package root, holding the vendored leitmotif WAVs. */
export const ASSET_SUBDIR: string = join('assets', 'leitmotifs');

/**
 * Full path to the strike ledger database, honouring `SELF_EXPRESSION_HOME` exactly
 * as the expression log does.
 *
 * @example
 *   audioDbPath({}, '/Users/ada')  // => '/Users/ada/.self-expression/audio.sqlite3'
 */
export function audioDbPath(
  env  : Record<string, string | undefined> = process.env,
  home : string                             = homedir(),
): string {
  return join(dataDir(env, home), AUDIO_DB_FILE);
}

/**
 * The vendored asset directory, resolved from the directory the running bundle sits
 * in. The bundle lives at `dist/claudio.cjs`, so the assets are one level up at
 * `assets/leitmotifs/`.
 *
 * @param bundleDir - the running bundle's directory (`__dirname` in the CJS bundle)
 *
 * @example
 *   defaultAssetDir('C:/x/node_modules/self-expression/dist')
 *   // => 'C:/x/node_modules/self-expression/assets/leitmotifs'
 */
export function defaultAssetDir(bundleDir: string): string {
  return join(bundleDir, '..', ASSET_SUBDIR);
}
