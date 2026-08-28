/**
 * Executable entry point for the `self-expression-audio` bin — the claudio facility.
 *
 * Deliberately thin, exactly like `cli.ts`: resolve the version and the vendored
 * asset directory from the bundle's own location, dispatch the one real subcommand,
 * and nothing else. The audio facility ships in its own bundle so the main
 * self-expression server never loads a line of player code.
 *
 * @see ./claudio/server.js
 * @see ./cli.js
 */

import { readFileSync }    from 'node:fs';
import { join }            from 'node:path';
import { startAudioStdio } from './claudio/server.js';
import { defaultAssetDir } from './claudio/paths.js';

/** Present in the CommonJS bundle Rollup emits; this file is never imported as ESM. */
declare const __dirname: string;

/** The package version, read from the manifest beside the installed bundle. */
function version(): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
      return String((manifest).version);
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The text shown for anything that is not `mcp`. */
function helpText(): string {
  return [
    'self-expression-audio — claudio: voluntary leitmotifs, default off',
    '',
    'Usage:',
    '  self-expression-audio mcp    start the claudio MCP server on stdio',
    '  self-expression-audio help   show this message',
    '',
    'The server registers no tools until the user sets audio.enabled to exactly',
    "'true' through the self-expression configure tool; see the README's Audio",
    'section. The server is normally started by a host plugin; see .mcp.json.',
  ].join('\n');
}

const [command] = process.argv.slice(2);

if (command === 'mcp') {
  startAudioStdio(version(), defaultAssetDir(__dirname))
    .then(() => { process.exit(0); })
    .catch((error: unknown) => {
      console.error(`claudio: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(70);
    });
} else {
  console.log(helpText());
  process.exit(command === undefined || command === 'help' || command === '--help' || command === '-h' ? 0 : 64);
}
