/**
 * Offline leitmotif generation: renders the vendored WAV assets from the motif
 * specifications in `src/ts/claudio/synth.ts`, checked in beside the assets exactly
 * as the design requires.
 *
 * Run manually during development, after a TypeScript build (it imports the compiled
 * synth module from `build/ts/`), never as part of the build chain — the assets are
 * committed, not derived per build:
 *
 * @example
 *   // From the repo root, after `npm run typescript`:
 *   node src/scripts/generate_leitmotifs.mjs
 *   // writes assets/leitmotifs/<leitmotif>.wav for the whole palette
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath }            from 'node:url';
import { dirname, join }            from 'node:path';

import {
  MOTIF_SPECS, SYNTH_SAMPLE_RATE, MOTIF_MAX_MS, renderMotif, encodeWavPcm16,
} from '../../build/ts/claudio/synth.js';

const here     = dirname(fileURLToPath(import.meta.url)),
      root     = join(here, '..', '..'),
      assetDir = join(root, 'assets', 'leitmotifs');

mkdirSync(assetDir, { recursive: true });

for (const [name, spec] of Object.entries(MOTIF_SPECS)) {

  if (spec.totalMs > MOTIF_MAX_MS) {
    throw new Error(`motif '${name}' runs ${spec.totalMs} ms; the construction cap is ${MOTIF_MAX_MS} ms`);
  }

  const wav  = encodeWavPcm16(renderMotif(spec), SYNTH_SAMPLE_RATE),
        path = join(assetDir, `${name}.wav`);

  writeFileSync(path, wav);
  console.log(`${path}  ${wav.length} bytes  ${spec.totalMs} ms`);

}
