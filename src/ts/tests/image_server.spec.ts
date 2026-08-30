/**
 * Registration tests: the tool must be **absent** from the schema, not present and
 * refusing, whenever the facility cannot actually run.
 *
 * The trick used throughout, borrowed from `dwell_tool.spec.ts`: register the tool a
 * second time. The SDK throws on a duplicate name, so a throw proves it was already
 * there and a clean registration proves it was not.
 */

import { describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { buildServer, resolveImageFacility } from '../mcp/server.js';
import {
  IMAGE_TOOL_NAME, newImageSessionId, registerImageTools,
} from '../mcp/image_tools.js';
import type { ImageDeps } from '../mcp/image_tools.js';
import { closeImageLedger, openImageLedger } from '../imagery/ledger.js';
import type { ImageLedger } from '../imagery/ledger.js';
import {
  IMAGE_API_KEY_ENV_KEY, IMAGE_ENABLED_KEY, IMAGE_PROVIDER_KEY,
} from '../imagery/config.js';

const KEY      = 'sk-proj-FAKE0123456789abcdefGHIJKLmnop',
      ENV_NAME = 'SE_TEST_IMAGE_KEY';

interface Rig {
  readonly store  : Store;
  readonly ledger : ImageLedger;
  readonly deps   : ImageDeps;
  readonly dir    : string;
}

function withRig<T>(fn: (rig: Rig) => T): T {

  const dir    = mkdtempSync(join(tmpdir(), 'se-image-server-')),
        store  = openStore(join(dir, 'log.sqlite3')),
        ledger = openImageLedger(join(dir, 'images.sqlite3'));

  const deps: ImageDeps = {
    send       : () => Promise.resolve({ status: 200, text: '{}' }),
    imagesRoot : join(dir, 'images'),
    sessionId  : newImageSessionId(),
    env        : { [ENV_NAME]: KEY },
  };

  try { return fn({ store, ledger, deps, dir }); }
  finally { closeStore(store); closeImageLedger(ledger); rmSync(dir, { recursive: true, force: true }); }

}

/** Register the tool again; a throw means it was already in the schema. */
function alreadyRegistered(server: McpServer, rig: Rig): boolean {
  try { registerImageTools(server, rig.store, rig.ledger, rig.deps, '0.0.0'); return false; }
  catch { return true; }
}

describe('buildServer and the image tool', () => {

  test('a fresh install has no image tool at all', () => withRig(rig => {
    expect(alreadyRegistered(buildServer(rig.store, '0.0.0', null, null, null), rig)).toBe(false);
  }));

  test('resolving from configuration on a fresh install finds nothing', () => withRig(rig => {
    expect(resolveImageFacility(rig.store, {})).toBeNull();
    expect(alreadyRegistered(buildServer(rig.store, '0.0.0', null, null), rig)).toBe(false);
  }));

  test('enabled but keyless still registers nothing — a locked door costs no attention', () => withRig(rig => {
    writeConfig(rig.store, IMAGE_ENABLED_KEY, 'true');
    writeConfig(rig.store, IMAGE_API_KEY_ENV_KEY, ENV_NAME);
    expect(resolveImageFacility(rig.store, {})).toBeNull();
  }));

  test('handed an open facility, buildServer registers the tool', () => withRig(rig => {
    const server = buildServer(rig.store, '0.0.0', null, null,
                               { ledger: rig.ledger, deps: rig.deps });
    expect(alreadyRegistered(server, rig)).toBe(true);
  }));

  test('a provider needing no credential resolves without any environment at all', () => withRig(rig => {
    writeConfig(rig.store, IMAGE_ENABLED_KEY, 'true');
    writeConfig(rig.store, IMAGE_PROVIDER_KEY, 'automatic1111');
    const resolved = resolveImageFacility(rig.store, { SELF_EXPRESSION_HOME: rig.dir });
    expect(resolved).not.toBeNull();
    if (resolved !== null) { closeImageLedger(resolved.ledger); }
  }));

  test('the resolved facility writes its ledger under SELF_EXPRESSION_HOME', () => withRig(rig => {
    writeConfig(rig.store, IMAGE_ENABLED_KEY, 'true');
    writeConfig(rig.store, IMAGE_PROVIDER_KEY, 'automatic1111');
    const resolved = resolveImageFacility(rig.store, { SELF_EXPRESSION_HOME: rig.dir });
    expect(resolved?.ledger.path).toBe(join(rig.dir, 'images.sqlite3'));
    expect(resolved?.deps.imagesRoot).toBe(join(rig.dir, 'images'));
    if (resolved != null) { closeImageLedger(resolved.ledger); }
  }));

  test('the registered tool is named what the constant says, so permission caches are stable', () => {
    expect(IMAGE_TOOL_NAME).toBe('generate_image');
  });

  test('registering on a bare server does not throw', () => withRig(rig => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => { registerImageTools(server, rig.store, rig.ledger, rig.deps, '0.0.0'); }).not.toThrow();
  }));

  test('the tool description warns that every call spends money', () => withRig(rig => {
    // The description is the only thing a host shows the model before it calls, so the
    // cost warning has to live there rather than in the reply.
    const descriptions: string[] = [];
    const spy = {
      registerTool: (_name: string, config: { description: string }) => {
        descriptions.push(config.description);
      },
    } as unknown as McpServer;
    registerImageTools(spy, rig.store, rig.ledger, rig.deps, '0.0.0');
    expect(descriptions[0]).toContain("spends the user's money");
    expect(descriptions[0]).toContain('do not reword');
  }));

});
