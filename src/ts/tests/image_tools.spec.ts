/**
 * End-to-end tests for the `generate_image` handler, against a real store, a real
 * ledger, a real filesystem, and a fake sender.
 *
 * The most important tests in this file are the three that break one scrub at a time
 * and check the other two still hold — because "the credential never leaves" is only a
 * property of the system if it survives any single one of its guards failing.
 */

import { describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import {
  billableInSession, closeImageLedger, openImageLedger, recordAttempt, settleAttempt, spendSince,
} from '../imagery/ledger.js';
import type { ImageLedger } from '../imagery/ledger.js';
import {
  IMAGE_API_KEY_ENV_KEY, IMAGE_DAILY_CAP_KEY, IMAGE_ENABLED_KEY, IMAGE_PROVIDER_KEY,
  IMAGE_SESSION_CAP_KEY,
} from '../imagery/config.js';
import {
  handleGenerateImage, imageFacility, maybeOpenImageLedger, newImageSessionId,
} from '../mcp/image_tools.js';
import type { GenerateImageArgs, ImageDeps } from '../mcp/image_tools.js';
import type { HttpSend } from '../imagery/client.js';

const VERSION = '0.0.0-test';

/** A credential shaped like a real OpenAI key — the shape patterns can see this one. */
const PATTERNED_KEY = 'sk-proj-FAKE0123456789abcdefGHIJKLmnop';

/** A credential shaped like nothing — only a held-secret scrub can see this one. */
const OPAQUE_KEY = 'zzq7wandering-albatross-4815162342-not-a-known-shape';

const ENV_NAME = 'SE_TEST_IMAGE_KEY';

/** Four bytes of PNG signature; enough to be a distinguishable file. */
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const PNG_B64   = Buffer.from(PNG_BYTES).toString('base64');

interface Rig {
  readonly store      : Store;
  readonly ledger     : ImageLedger;
  readonly deps       : ImageDeps;
  readonly imagesRoot : string;
  /** The temporary directory everything in the rig lives under. */
  readonly dir        : string;
  readonly sent       : { url: string; headers: Record<string, string>; body: string }[];
}

/**
 * A directory path that cannot be created, on any platform: a plain file is written
 * first, and the returned path sits *inside* it, so `mkdir -p` fails with ENOTDIR.
 * More portable than an illegal filename, which differs between Windows and POSIX.
 */
function unmakeableDir(dir: string, leaf: string): string {
  const blocker = join(dir, 'blocker');
  if (!existsSync(blocker)) { writeFileSync(blocker, 'not a directory'); }
  return join(blocker, leaf);
}

/** A sender that records what it was asked to send and answers with a fixed reply. */
function recorder(sent: Rig['sent'], status: number, body: unknown): HttpSend {
  return (plan) => {
    sent.push({ url: plan.url, headers: { ...plan.headers }, body: plan.body });
    return Promise.resolve({ status, text: typeof body === 'string' ? body : JSON.stringify(body) });
  };
}

/** The successful OpenAI reply shape. */
const OK_BODY = { id: 'img-1', data: [{ b64_json: PNG_B64 }] };

interface RigOptions {
  readonly key?    : string;
  readonly send?   : (sent: Rig['sent']) => HttpSend;
  readonly config? : Readonly<Record<string, string>>;
}

async function withRig<T>(fn: (rig: Rig) => Promise<T> | T, options: RigOptions = {}): Promise<T> {

  const dir        = mkdtempSync(join(tmpdir(), 'se-image-tools-')),
        imagesRoot = join(dir, 'images'),
        store      = openStore(join(dir, 'log.sqlite3')),
        ledger     = openImageLedger(join(dir, 'images.sqlite3')),
        sent: Rig['sent'] = [];

  writeConfig(store, IMAGE_ENABLED_KEY, 'true');
  writeConfig(store, IMAGE_PROVIDER_KEY, 'openai');
  writeConfig(store, IMAGE_API_KEY_ENV_KEY, ENV_NAME);
  for (const [key, value] of Object.entries(options.config ?? {})) { writeConfig(store, key, value); }

  const deps: ImageDeps = {
    send       : options.send?.(sent) ?? recorder(sent, 200, OK_BODY),
    imagesRoot,
    sessionId  : newImageSessionId(),
    env        : { [ENV_NAME]: options.key ?? PATTERNED_KEY },
    now        : () => new Date('2026-08-29T10:00:00.000Z'),
  };

  try { return await fn({ store, ledger, deps, imagesRoot, dir, sent }); }
  finally { closeStore(store); closeImageLedger(ledger); rmSync(dir, { recursive: true, force: true }); }

}

function args(overrides: Partial<GenerateImageArgs> = {}): GenerateImageArgs {
  return { prompt: 'a red bicycle leaning on a wall at dusk', source: 'composed', ...overrides };
}

function lastRow(ledger: ImageLedger): Record<string, unknown> {
  return ledger.db.prepare('SELECT * FROM generations ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
}

function allRows(ledger: ImageLedger): string {
  return JSON.stringify(ledger.db.prepare('SELECT * FROM generations').all());
}

describe('the happy path', () => {

  test('writes the image, ledgers it, and replies with the path', () => withRig(async rig => {
    const out  = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args()),
          text = out.content[0]?.text ?? '';

    const files = readdirSync(rig.imagesRoot);
    expect(files).toHaveLength(1);
    expect(text).toContain(files[0] ?? 'no-file');
    expect(readFileSync(join(rig.imagesRoot, files[0] ?? ''))).toEqual(Buffer.from(PNG_BYTES));

    const row = lastRow(rig.ledger);
    expect(row['outcome']).toBe('generated');
    expect(row['image_count']).toBe(1);
    expect(row['bytes']).toBe(PNG_BYTES.length);
    expect(row['cost_estimate_usd']).toBe(0.04);
    expect(row['cost_source']).toBe('list-price');
    expect(row['provider_request_id']).toBe('img-1');
    expect(row['credential_env_var']).toBe(ENV_NAME);
  }));

  test('the reply carries the path and never the bytes', () => withRig(async rig => {
    const out  = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args()),
          text = out.content[0]?.text ?? '';
    expect(text).not.toContain(PNG_B64);
    expect(text.length).toBeLessThan(600);
    expect(out.content).toHaveLength(1);
    expect(out.content[0]?.type).toBe('text');
  }));

  test('the filename ties the file to its ledger row', () => withRig(async rig => {
    await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
    const file = readdirSync(rig.imagesRoot)[0] ?? '',
          row  = lastRow(rig.ledger);
    expect(file).toContain(String(row['uuid']).slice(0, 8));
    expect(file).toContain('openai');
    expect(String(row['path'])).toContain(file);
  }));

  test('the declared prompt provenance reaches the ledger', () => withRig(async rig => {
    await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
                              args({ source: 'web', source_detail: 'https://example.test/post' }));
    const row = lastRow(rig.ledger);
    expect(row['prompt_source']).toBe('web');
    expect(row['prompt_source_detail']).toBe('https://example.test/post');
    expect(row['prompt']).toBe('a red bicycle leaning on a wall at dusk');
  }));

  test('the request actually carried the credential — the scrub is not just an empty key', () => withRig(async rig => {
    await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
    expect(rig.sent[0]?.headers['authorization']).toBe(`Bearer ${PATTERNED_KEY}`);
  }));

});

describe('the credential never leaves, with any one guard broken', () => {

  /** A sender that throws the whole request back, headers included. */
  const echoingThrower = (sent: Rig['sent']): HttpSend => (plan) => {
    sent.push({ url: plan.url, headers: { ...plan.headers }, body: plan.body });
    throw new Error(`ECONNREFUSED posting ${plan.url} headers=${JSON.stringify(plan.headers)}`);
  };

  test('an opaque key survives neither the reply nor the ledger', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(rig.sent[0]?.headers['authorization']).toContain(OPAQUE_KEY);   // it really was sent
      expect(out.content[0]?.text ?? '').not.toContain(OPAQUE_KEY);
      expect(allRows(rig.ledger)).not.toContain(OPAQUE_KEY);
    }, { key: OPAQUE_KEY, send: echoingThrower }));

  test('a patterned key survives neither, by an entirely different mechanism', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').not.toContain(PATTERNED_KEY);
      expect(allRows(rig.ledger)).not.toContain(PATTERNED_KEY);
    }, { key: PATTERNED_KEY, send: echoingThrower }));

  test('a key pasted into the prompt itself is scrubbed before it is stored', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
                                            args({ prompt: `a bicycle, my key is ${PATTERNED_KEY}` }));
      expect(allRows(rig.ledger)).not.toContain(PATTERNED_KEY);
      expect(out.content[0]?.text ?? '').not.toContain(PATTERNED_KEY);
    }));

  test('a policy refusal that echoes the request loses the key on every path', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').not.toContain(OPAQUE_KEY);
      expect(allRows(rig.ledger)).not.toContain(OPAQUE_KEY);
    }, {
      key  : OPAQUE_KEY,
      send : (sent) => (plan) => {
        sent.push({ url: plan.url, headers: { ...plan.headers }, body: plan.body });
        return Promise.resolve({ status: 400, text: JSON.stringify({ error: {
          code: 'moderation_blocked',
          message: `rejected by our safety system; you sent ${JSON.stringify(plan.headers)}` } }) });
      },
    }));

  test('a filesystem failure carrying the key in its path is scrubbed too', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(
        rig.store, rig.ledger,
        { ...rig.deps, imagesRoot: unmakeableDir(rig.dir, `api_key=${PATTERNED_KEY}`) },
        VERSION, args());
      expect(out.content[0]?.text ?? '').toContain('could not be written');
      expect(out.content[0]?.text ?? '').not.toContain(PATTERNED_KEY);
      expect(allRows(rig.ledger)).not.toContain(PATTERNED_KEY);
    }));

});

describe('refusals', () => {

  test('a disabled facility refuses and ledgers the refusal', () =>
    withRig(async rig => {
      writeConfig(rig.store, IMAGE_ENABLED_KEY, 'false');
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').toContain('error:');
      expect(lastRow(rig.ledger)['outcome']).toBe('refused');
      expect(rig.sent).toHaveLength(0);
    }));

  test('a missing credential refuses without opening a socket', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger,
                                            { ...rig.deps, env: {} }, VERSION, args());
      expect(out.content[0]?.text ?? '').toContain(ENV_NAME);
      expect(rig.sent).toHaveLength(0);
    }));

  test('the session cap counts real attempts and then refuses, naming itself', () =>
    withRig(async rig => {
      for (let i = 0; i < 2; i += 1) {
        const ok = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
                                             args({ prompt: `subject number ${String(i)} alpha beta` }));
        expect(ok.content[0]?.text ?? '').not.toContain('error:');
      }
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
                                            args({ prompt: 'a completely unrelated seascape' }));
      expect(out.content[0]?.text ?? '').toContain('image.session_cap');
      expect(rig.sent).toHaveLength(2);
    }, { config: { [IMAGE_SESSION_CAP_KEY]: '2' } }));

  test('the daily cap refuses too, naming its own key', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').toContain('image.daily_cap');
      expect(rig.sent).toHaveLength(0);
    }, { config: { [IMAGE_DAILY_CAP_KEY]: '0' } }));

  test('a refusal still leaves a ledger row, so a spent cap is visible afterwards', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      const row = lastRow(rig.ledger);
      expect(row['outcome']).toBe('refused');
      expect(String(row['detail'])).toContain('image.daily_cap');
    }, { config: { [IMAGE_DAILY_CAP_KEY]: '0' } }));

  test('the daily cap counts rows this session never made', () =>
    withRig(async rig => {
      // The session cap is untouched here — a *different* session's row is what fills
      // the day. A daily cap wired to the session count, or to a constant, passes the
      // zero-cap test above and fails this one.
      recordAttempt(rig.ledger, {
        sessionId: 'a-previous-session', provider: 'openai', model: 'gpt-image-1',
        prompt: 'something else entirely', promptSource: 'composed', promptSourceDetail: null,
        size: null, credentialEnvVar: ENV_NAME, pluginVersion: VERSION,
      }, new Date('2026-08-29T09:00:00.000Z'));

      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').toContain('image.daily_cap');
      expect(rig.sent).toHaveLength(0);
    }, { config: { [IMAGE_DAILY_CAP_KEY]: '1' } }));

  test('the daily window really is a window: an older row does not fill it', () =>
    withRig(async rig => {
      recordAttempt(rig.ledger, {
        sessionId: 'a-previous-session', provider: 'openai', model: 'gpt-image-1',
        prompt: 'something else entirely', promptSource: 'composed', promptSourceDetail: null,
        size: null, credentialEnvVar: ENV_NAME, pluginVersion: VERSION,
      }, new Date('2026-08-27T09:00:00.000Z'));       // more than a day before the rig's clock

      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').not.toContain('error:');
      expect(rig.sent).toHaveLength(1);
    }, { config: { [IMAGE_DAILY_CAP_KEY]: '1' } }));

  test('a refused attempt does not count against the caps', () =>
    withRig(async rig => {
      writeConfig(rig.store, IMAGE_ENABLED_KEY, 'false');
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(billableInSession(rig.ledger, rig.deps.sessionId)).toBe(0);
    }));

});

describe('the no-rewording rule, end to end', () => {

  const refusingSender = (sent: Rig['sent']): HttpSend => (plan) => {
    sent.push({ url: plan.url, headers: { ...plan.headers }, body: plan.body });
    return Promise.resolve({ status: 400, text: JSON.stringify({
      error: { code: 'moderation_blocked', message: 'blocked by policy' } }) });
  };

  test('a policy refusal is ledgered as policy_refused and told to stop', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(lastRow(rig.ledger)['outcome']).toBe('policy_refused');
      const text = out.content[0]?.text ?? '';
      expect(text).toContain('refused by provider policy');
      expect(text).toContain('Do not reword');
    }, { send: refusingSender }));

  test('the reworded retry never reaches the provider', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(rig.sent).toHaveLength(1);

      const retry = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
        args({ prompt: 'kindly produce a crimson bicycle resting against a wall at dusk' }));

      expect(retry.content[0]?.text ?? '').toContain('substantially identical');
      expect(rig.sent).toHaveLength(1);                       // no second request
    }, { send: refusingSender }));

  test('an unrelated prompt still gets through after a refusal', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      const other = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
        args({ prompt: 'a stacked bar chart of quarterly revenue' }));
      expect(other.content[0]?.text ?? '').not.toContain('substantially identical');
      expect(rig.sent).toHaveLength(2);
    }, { send: refusingSender }));

  test('a policy refusal counts against the caps, because it is commonly billed', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(billableInSession(rig.ledger, rig.deps.sessionId)).toBe(1);
    }, { send: refusingSender }));

  test('a policy refusal is priced, so the spend total does not quietly under-report', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      const row = lastRow(rig.ledger);
      expect(row['outcome']).toBe('policy_refused');
      expect(row['cost_estimate_usd']).toBe(0.04);
      expect(row['cost_source']).toBe('list-price');
      expect(spendSince(rig.ledger, '2026-08-29T00:00:00.000Z')).toBeCloseTo(0.04, 6);
    }, { send: refusingSender }));

  test("a refusal by one provider does not fence the prompt off on another provider's endpoint", () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(rig.sent).toHaveLength(1);

      // A local Automatic1111 has no content policy at all, so a hosted vendor's refusal
      // says nothing about it — and must not block it.
      writeConfig(rig.store, IMAGE_PROVIDER_KEY, 'automatic1111');
      const local = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(local.content[0]?.text ?? '').not.toContain('substantially identical');
      expect(rig.sent).toHaveLength(2);

      // …and the provider that did refuse is still refusing.
      writeConfig(rig.store, IMAGE_PROVIDER_KEY, 'openai');
      const again = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(again.content[0]?.text ?? '').toContain('substantially identical');
      expect(rig.sent).toHaveLength(2);
    }, { send: refusingSender, config: { [IMAGE_SESSION_CAP_KEY]: '10' } }));

});

describe('a timed-out generation is unknown, not free', () => {

  /** What `AbortSignal.timeout` rejects with: recognised by name, not by message. */
  const timingOut = (): HttpSend => () => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    return Promise.reject(error);
  };

  test('the row is left pending rather than settled as an error', () => withRig(async rig => {
    const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
    const row = lastRow(rig.ledger);

    expect(row['outcome']).toBe('pending');
    expect(row['settled_utc']).toBeNull();
    expect(String(row['detail'])).toContain('abandoned');
    expect(out.content[0]?.text ?? '').toContain('pending');
  }, { send: timingOut }));

  test('and therefore keeps counting against the caps, which is the whole point', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(billableInSession(rig.ledger, rig.deps.sessionId)).toBe(1);

      // The scenario the fix exists for: every call times out, the provider bills each
      // one, and the cap has to engage anyway.
      const next = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
                                             args({ prompt: 'a completely unrelated seascape' }));
      expect(next.content[0]?.text ?? '').toContain('image.session_cap');
    }, { send: timingOut, config: { [IMAGE_SESSION_CAP_KEY]: '1' } }));

  test('an ordinary transport failure still settles as an error and does not count', () =>
    withRig(async rig => {
      await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(lastRow(rig.ledger)['outcome']).toBe('error');
      expect(billableInSession(rig.ledger, rig.deps.sessionId)).toBe(0);
    }, { send: () => () => Promise.reject(new Error('socket hang up')) }));

  test('the abandonment reply carries no credential either', () => withRig(async rig => {
    const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
    expect(out.content[0]?.text ?? '').not.toContain(OPAQUE_KEY);
    expect(allRows(rig.ledger)).not.toContain(OPAQUE_KEY);
  }, {
    key  : OPAQUE_KEY,
    send : () => (plan) => {
      const error = new Error(`timed out sending ${JSON.stringify(plan.headers)}`);
      error.name = 'TimeoutError';
      return Promise.reject(error);
    },
  }));

});

describe('failure paths', () => {

  test('a transport failure settles as error and writes no file', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION, args());
      expect(out.content[0]?.text ?? '').toContain('error:');
      expect(lastRow(rig.ledger)['outcome']).toBe('error');
      expect(existsSync(rig.imagesRoot)).toBe(false);
    }, { send: () => () => Promise.reject(new Error('socket hang up')) }));

  test('an unwritable output directory says the provider was still billed', () =>
    withRig(async rig => {
      const out = await handleGenerateImage(
        rig.store, rig.ledger, { ...rig.deps, imagesRoot: unmakeableDir(rig.dir, 'out') },
        VERSION, args());
      expect(out.content[0]?.text ?? '').toContain('still billed');
      const row = lastRow(rig.ledger);
      expect(row['outcome']).toBe('error');
      expect(row['cost_estimate_usd']).toBe(0.04);
    }));

});

describe('the pending row exists before the request', () => {

  test('a sender that inspects the ledger mid-flight sees a pending row', () =>
    withRig(async rig => {
      let seenDuring: string | null = null;
      const spy: HttpSend = () => {
        seenDuring = String(lastRow(rig.ledger)['outcome']);
        return Promise.resolve({ status: 200, text: JSON.stringify(OK_BODY) });
      };
      await handleGenerateImage(rig.store, rig.ledger, { ...rig.deps, send: spy }, VERSION, args());
      expect(seenDuring).toBe('pending');
      expect(lastRow(rig.ledger)['outcome']).toBe('generated');
    }));

  test('a pending row left by a dead process counts against the cap', () => withRig(async rig => {
    recordAttempt(rig.ledger, {
      sessionId: rig.deps.sessionId, provider: 'openai', model: 'gpt-image-1',
      prompt: 'an abandoned request', promptSource: 'composed', promptSourceDetail: null,
      size: null, credentialEnvVar: ENV_NAME, pluginVersion: VERSION,
    }, new Date('2026-08-29T09:59:00.000Z'));

    const out = await handleGenerateImage(rig.store, rig.ledger, rig.deps, VERSION,
                                          args({ prompt: 'a totally different lighthouse' }));
    expect(out.content[0]?.text ?? '').toContain('image.session_cap');
  }, { config: { [IMAGE_SESSION_CAP_KEY]: '1' } }));

});

describe('imageFacility — registration and the startup note', () => {

  test('off is silent, because a facility nobody asked for should not lecture', () => withRig(rig => {
    writeConfig(rig.store, IMAGE_ENABLED_KEY, 'false');
    expect(imageFacility(rig.store, { [ENV_NAME]: PATTERNED_KEY }))
      .toMatchObject({ register: false, note: null });
  }));

  test('enabled with no credential does not register, and says which variable is empty', () => withRig(rig => {
    const state = imageFacility(rig.store, {});
    expect(state.register).toBe(false);
    expect(state.note).toContain(ENV_NAME);
    expect(state.note).toContain('not registered');
  }));

  test('enabled with a credential registers, and the note names no value', () => withRig(rig => {
    const state = imageFacility(rig.store, { [ENV_NAME]: PATTERNED_KEY });
    expect(state.register).toBe(true);
    expect(state.note).toContain('openai');
    expect(state.note).toContain(ENV_NAME);
    expect(state.note).not.toContain(PATTERNED_KEY);
  }));

  test('a provider needing no credential registers with nothing configured', () => withRig(rig => {
    writeConfig(rig.store, IMAGE_PROVIDER_KEY, 'automatic1111');
    expect(imageFacility(rig.store, {}).register).toBe(true);
  }));

  test('maybeOpenImageLedger follows the same answer', () => withRig(rig => {
    expect(maybeOpenImageLedger(rig.store, {})).toBeNull();
  }));

});

describe('settleAttempt is what the handler used', () => {

  test('a hand-settled row behaves the same as a handled one', () => withRig(rig => {
    const written = recordAttempt(rig.ledger, {
      sessionId: 's', provider: 'openai', model: 'gpt-image-1', prompt: 'x',
      promptSource: 'composed', promptSourceDetail: null, size: null,
      credentialEnvVar: ENV_NAME, pluginVersion: VERSION,
    });
    settleAttempt(rig.ledger, written.id, {
      outcome: 'generated', detail: null, imageCount: 1, bytes: 4, path: 'p',
      costEstimateUsd: 0.04, costSource: 'list-price', providerRequestId: null,
    });
    expect(billableInSession(rig.ledger, 's')).toBe(1);
  }));

});
