/**
 * The MCP resource surface: the conventions, served to hosts that cannot load skills.
 *
 * Separated from `tools.ts` for the same reason the tool registrations are separated
 * from the transport — the interesting behaviour is the reading, which is pure and lives
 * in `../channels/conventions.ts`, and this file is only the wiring that hands it to a
 * server.
 *
 * Resources rather than a longer `instructions` string; the argument is set out in
 * {@link ../channels/conventions.js} and comes down to one sentence: `instructions` is
 * delivered unconditionally on every host, and three of this plugin's hosts already load
 * these exact files as skills.
 *
 * @see ../channels/conventions.js
 * @see ./server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  CONVENTION_DOCS, availableConventions, conventionUri, readConvention,
} from '../channels/conventions.js';
import type { ConventionDoc } from '../channels/conventions.js';

/** The MIME type every convention document is served as. */
export const CONVENTION_MIME = 'text/markdown';

/**
 * What a client receives when it reads a convention resource whose file has gone
 * missing between registration and the read.
 *
 * A body rather than a thrown error, and it says so out loud: the resource was listed,
 * so the client is entitled to an answer, and "the package is incomplete" is a far more
 * useful answer than a protocol failure with no explanation attached.
 */
export function missingConventionBody(doc: ConventionDoc): string {
  return `# ${doc.title}\n\nunknown — this document is registered but its file could not be ` +
         `read from the installed package (expected ${doc.path.join('/')}). The install is ` +
         `incomplete; nothing about the conventions themselves has changed.`;
}

/**
 * Register one resource per available convention document, and report how many.
 *
 * Only documents whose files actually exist are registered, so a client's resource list
 * never advertises something a read would fail on. On a root of `null` — no package root
 * found — nothing is registered and the count is zero: the server still starts, still
 * serves every tool, and simply has no conventions to hand out. That degradation is
 * deliberate, because the alternative is a plugin that refuses to run because it could
 * not find its own documentation.
 *
 * Registering any resource is what makes the server advertise the `resources` capability
 * at all, which is why a hookless-but-skill-less host discovers these by listing rather
 * than by being told each URI.
 *
 * @param server the server to register on
 * @param root   the package root the documents are read from, or `null` for none
 * @returns how many resources were registered
 *
 * @example
 *   registerConventionResources(server, '/pkg')   // => 7
 *   registerConventionResources(server, null)     // => 0
 *
 * @see ../channels/conventions.js availableConventions
 */
export function registerConventionResources(server: McpServer, root: string | null): number {

  const docs = availableConventions(root);

  for (const doc of docs) {
    server.registerResource(doc.id, conventionUri(doc.id), {
      title       : doc.title,
      description : doc.description,
      mimeType    : CONVENTION_MIME,
    }, (uri) => ({
      contents: [{
        uri      : uri.href,
        mimeType : CONVENTION_MIME,
        // Read at request time, never cached: an edited skill should serve its new text
        // the same day, and the file is read at most a handful of times per session.
        text     : (root === null ? null : readConvention(root, doc)) ?? missingConventionBody(doc),
      }],
    }));
  }

  return docs.length;

}

/**
 * Every document id the registry declares, in reading order — the enumeration tests and
 * callers use instead of reaching into {@link CONVENTION_DOCS} and mapping it themselves.
 *
 * @example
 *   CONVENTION_IDS[0]   // => 'self-expression'
 */
export const CONVENTION_IDS: readonly string[] = CONVENTION_DOCS.map(doc => doc.id);
