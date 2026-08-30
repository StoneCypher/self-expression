/**
 * Where generated images and their ledger live.
 *
 * Both ride the same data directory as the expression log — one `SELF_EXPRESSION_HOME`
 * relocates everything — with the images in `<dataDir>/images/` beside the `renders/`
 * directory the history PNGs already use, and the ledger in its **own database file**,
 * for the same reason the audio ledger has one: a broken image ledger must never be
 * able to take the expression log down with it.
 *
 * Storing the bytes locally rather than handing back a provider URL is not only a
 * privacy choice. A local file is servable from the panel's own origin, so
 * `img-src 'self'` survives; a hotlinked provider CDN would have cost a CSP exception
 * for every provider ever added.
 *
 * @see ../channels/paths.js
 * @see ./ledger.js
 */

import { homedir } from 'node:os';
import { join }    from 'node:path';
import { dataDir } from '../channels/paths.js';

/** Filename of the generation ledger inside the shared data directory. */
export const IMAGE_DB_FILE = 'images.sqlite3';

/** Directory name, under the data directory, holding generated images. */
export const IMAGES_SUBDIR = 'images';

/**
 * Full path to the generation ledger database, honouring `SELF_EXPRESSION_HOME`.
 *
 * @example
 *   imageDbPath({}, '/Users/ada')  // => '/Users/ada/.self-expression/images.sqlite3'
 */
export function imageDbPath(
  env  : Record<string, string | undefined> = process.env,
  home : string                             = homedir(),
): string {
  return join(dataDir(env, home), IMAGE_DB_FILE);
}

/**
 * The directory generated images are written to, honouring `SELF_EXPRESSION_HOME`.
 *
 * @example
 *   imagesDir({}, '/Users/ada')  // => '/Users/ada/.self-expression/images'
 */
export function imagesDir(
  env  : Record<string, string | undefined> = process.env,
  home : string                             = homedir(),
): string {
  return join(dataDir(env, home), IMAGES_SUBDIR);
}

/**
 * The filename for one generated image.
 *
 * Provider, then instant, then the ledger row's uuid: the provider makes a directory
 * listing readable at a glance, the timestamp orders it, and the uuid is what ties the
 * file back to its ledger row — so a file found on disk months later can always be
 * traced to the prompt that made it. Colons are hyphenated because Windows will not
 * accept them in a filename.
 *
 * @param provider  - the provider id that generated the image
 * @param when      - the attempt instant
 * @param uuid      - the ledger row's uuid
 * @param extension - the filename extension, without the dot
 * @param index     - which image of the reply this is, from zero
 *
 * @example
 *   imageFileName('openai', new Date('2026-08-29T10:00:00Z'), 'a1b2c3d4-…', 'png', 0)
 *   // => 'openai_2026-08-29T10-00-00Z_a1b2c3d4.png'
 */
export function imageFileName(
  provider  : string,
  when      : Date,
  uuid      : string,
  extension : string,
  index     : number,
): string {

  const stamp = when.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-'),
        short = uuid.slice(0, 8),
        tail  = index === 0 ? '' : `_${String(index)}`;

  return `${provider}_${stamp}_${short}${tail}.${extension}`;

}
