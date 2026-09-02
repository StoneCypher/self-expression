/**
 * Generation ledger tests.
 *
 * Three claims are worth pinning here. The row exists **before** the request, so a
 * process that dies mid-call still leaves the evidence of a call that may have been
 * billed. The budget counts the outcomes that cost money and not the ones that do not.
 * And every text column is pattern-scrubbed on the way in, by the ledger itself, with
 * no credential in its hands at all.
 */

import { describe, test, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import {
  billableInSession, billableSince, closeImageLedger, markAbandoned, openImageLedger,
  policyRefusalsSince, promptDigest, recordAttempt, recordRefusal, settleAttempt, spendSince,
} from '../imagery/ledger.js';
import type { AttemptRecord, ImageLedger, Settlement } from '../imagery/ledger.js';
import { BILLABLE_OUTCOMES, GENERATION_OUTCOMES } from '../imagery/schema.js';
import type { GenerationOutcome } from '../imagery/schema.js';

const VERSION = '0.0.0-test',
      SESSION = 'session-one';

/** A key shaped like a real one, so the ledger's pattern scrub can recognise it. */
const PATTERNED_KEY = 'sk-proj-FAKE0123456789abcdefGHIJKLmnop';

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    sessionId          : SESSION,
    provider           : 'openai',
    model              : 'gpt-image-1',
    prompt             : 'a red bicycle',
    promptSource       : 'composed',
    promptSourceDetail : null,
    size               : '1024x1024',
    credentialEnvVar   : 'OPENAI_API_KEY',
    pluginVersion      : VERSION,
    ...overrides,
  };
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    outcome           : 'generated',
    detail            : null,
    imageCount        : 1,
    bytes             : 4096,
    path              : 'C:/x/images/openai_x.png',
    costEstimateUsd   : 0.04,
    costSource        : 'list-price',
    providerRequestId : 'img-1',
    ...overrides,
  };
}

function withLedger<T>(fn: (ledger: ImageLedger) => T): T {
  const dir    = mkdtempSync(join(tmpdir(), 'se-image-ledger-')),
        ledger = openImageLedger(join(dir, 'images.sqlite3'));
  try { return fn(ledger); }
  finally { closeImageLedger(ledger); rmSync(dir, { recursive: true, force: true }); }
}

function row(ledger: ImageLedger, id: number): Record<string, unknown> {
  return ledger.db.prepare('SELECT * FROM generations WHERE id = ?').get(id) as Record<string, unknown>;
}

function everything(ledger: ImageLedger): string {
  return JSON.stringify(ledger.db.prepare('SELECT * FROM generations').all());
}

describe('recordAttempt', () => {

  test('writes a pending row before anything is sent', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    expect(written.id).toBe(1);
    expect(written.uuid).toMatch(/^[0-9a-f-]{36}$/);
    const stored = row(ledger, written.id);
    expect(stored['outcome']).toBe('pending');
    expect(stored['settled_utc']).toBeNull();
    expect(stored['prompt']).toBe('a red bicycle');
  }));

  test('stores the credential variable NAME and has no column for a value', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    expect(row(ledger, written.id)['credential_env_var']).toBe('OPENAI_API_KEY');
    const columns = ledger.db.prepare('PRAGMA table_info(generations)').all()
      .map(entry => String(entry['name']));
    expect(columns).toContain('credential_env_var');
    for (const column of columns) {
      expect(/^(api_key|credential|secret|token)$/.test(column)).toBe(false);
    }
  }));

  test('records the prompt digest so identity survives the text being pruned', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    // Checked against a hardcoded SHA-256 rather than against promptDigest's own output:
    // comparing the code to itself would pass even if the digest became a constant, and
    // a digest that is the same for every prompt records nothing at all.
    expect(row(ledger, written.id)['prompt_sha256'])
      .toBe('1191409152a26c2e3a7b6e7e0fc0f0dbc04a0c2aef096f8e20239abd84a7c3c6');
  }));

  test('the digest actually distinguishes prompts', () => withLedger(ledger => {
    const first  = recordAttempt(ledger, attempt({ prompt: 'a red bicycle' })),
          second = recordAttempt(ledger, attempt({ prompt: 'a blue whale' }));
    expect(row(ledger, first.id)['prompt_sha256']).not.toBe(row(ledger, second.id)['prompt_sha256']);
    expect(String(row(ledger, first.id)['prompt_sha256'])).toMatch(/^[0-9a-f]{64}$/);
  }));

  test('promptDigest is a real SHA-256 of its input', () => {
    expect(promptDigest('a red bicycle'))
      .toBe('1191409152a26c2e3a7b6e7e0fc0f0dbc04a0c2aef096f8e20239abd84a7c3c6');
    expect(promptDigest('a blue whale')).not.toBe(promptDigest('a red bicycle'));
  });

  test('records the declared provenance and its detail', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt({
      promptSource: 'file', promptSourceDetail: 'C:/repo/notes/brief.md',
    }));
    const stored = row(ledger, written.id);
    expect(stored['prompt_source']).toBe('file');
    expect(stored['prompt_source_detail']).toBe('C:/repo/notes/brief.md');
  }));

});

describe('the ledger scrubs on the way in, holding no credential', () => {

  test('a key-shaped string in the prompt never reaches the row', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt({ prompt: `a bicycle, key ${PATTERNED_KEY}` }));
    expect(String(row(ledger, written.id)['prompt'])).not.toContain(PATTERNED_KEY);
    expect(everything(ledger)).not.toContain(PATTERNED_KEY);
  }));

  test('a key-shaped string in a settlement detail never reaches the row', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    settleAttempt(ledger, written.id, settlement({
      outcome: 'error', detail: `provider echoed Authorization: Bearer ${PATTERNED_KEY}`,
      imageCount: 0, bytes: null, path: null,
    }));
    expect(everything(ledger)).not.toContain(PATTERNED_KEY);
  }));

  test('a key-shaped string in the source detail or the path never reaches the row', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt({
      promptSourceDetail: `https://x.test/brief?api_key=${PATTERNED_KEY}`,
    }));
    settleAttempt(ledger, written.id, settlement({ path: `C:/x/${PATTERNED_KEY}.png` }));
    expect(everything(ledger)).not.toContain(PATTERNED_KEY);
  }));

  test('the digest is taken of the scrubbed prompt, so it matches what was stored', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt({ prompt: `bike ${PATTERNED_KEY}` }));
    const stored  = row(ledger, written.id);
    expect(stored['prompt_sha256']).toBe(promptDigest(String(stored['prompt'])));
  }));

});

describe('settleAttempt', () => {

  test('replaces the pending outcome and stamps the settlement time', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    settleAttempt(ledger, written.id, settlement());
    const stored = row(ledger, written.id);
    expect(stored['outcome']).toBe('generated');
    expect(stored['image_count']).toBe(1);
    expect(stored['bytes']).toBe(4096);
    expect(stored['cost_estimate_usd']).toBe(0.04);
    expect(stored['cost_source']).toBe('list-price');
    expect(stored['settled_utc']).not.toBeNull();
  }));

  test('leaves other rows alone', () => withLedger(ledger => {
    const first  = recordAttempt(ledger, attempt()),
          second = recordAttempt(ledger, attempt());
    settleAttempt(ledger, second.id, settlement());
    expect(row(ledger, first.id)['outcome']).toBe('pending');
  }));

});

describe('recordRefusal', () => {

  test('writes one settled refused row with the reason as its detail', () => withLedger(ledger => {
    const written = recordRefusal(ledger, attempt(), 'the per-session image cap (6) is spent');
    const stored  = row(ledger, written.id);
    expect(stored['outcome']).toBe('refused');
    expect(String(stored['detail'])).toContain('per-session');
    expect(stored['settled_utc']).not.toBeNull();
  }));

});

describe('the budget counts what costs money', () => {

  test('the billable set is exactly pending, generated, and policy_refused', () => {
    expect([...BILLABLE_OUTCOMES].sort()).toEqual(['generated', 'pending', 'policy_refused']);
    for (const outcome of GENERATION_OUTCOMES) {
      const billable = BILLABLE_OUTCOMES.includes(outcome);
      expect(billable).toBe(outcome !== 'error' && outcome !== 'refused');
    }
  });

  test('each outcome counts, or does not, as the set says', () => withLedger(ledger => {
    for (const [index, outcome] of GENERATION_OUTCOMES.entries()) {
      const written = recordAttempt(ledger, attempt({ sessionId: `s${String(index)}` }));
      if (outcome !== 'pending') {
        settleAttempt(ledger, written.id, settlement({ outcome: outcome as GenerationOutcome }));
      }
      expect(billableInSession(ledger, `s${String(index)}`))
        .toBe(BILLABLE_OUTCOMES.includes(outcome) ? 1 : 0);
    }
  }));

  test('a pending row counts, because an unknown call may still have been billed', () => withLedger(ledger => {
    recordAttempt(ledger, attempt());
    expect(billableInSession(ledger, SESSION)).toBe(1);
  }));

  test('a transport error does not count, because a network outage is not a purchase', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    settleAttempt(ledger, written.id, settlement({ outcome: 'error' }));
    expect(billableInSession(ledger, SESSION)).toBe(0);
  }));

  test('the session cap counts only this session', () => withLedger(ledger => {
    recordAttempt(ledger, attempt());
    recordAttempt(ledger, attempt({ sessionId: 'another' }));
    expect(billableInSession(ledger, SESSION)).toBe(1);
    expect(billableInSession(ledger, 'another')).toBe(1);
    expect(billableInSession(ledger, 'never-used')).toBe(0);
  }));

  test('the daily cap counts by time, across sessions, and excludes older rows', () => withLedger(ledger => {
    recordAttempt(ledger, attempt(), new Date('2026-08-28T10:00:00Z'));
    recordAttempt(ledger, attempt({ sessionId: 'other' }), new Date('2026-08-29T10:00:00Z'));
    expect(billableSince(ledger, '2026-08-29T00:00:00.000Z')).toBe(1);
    expect(billableSince(ledger, '2026-08-01T00:00:00.000Z')).toBe(2);
    expect(billableSince(ledger, '2026-09-01T00:00:00.000Z')).toBe(0);
  }));

  test('the window boundary is inclusive', () => withLedger(ledger => {
    recordAttempt(ledger, attempt(), new Date('2026-08-29T10:00:00.000Z'));
    expect(billableSince(ledger, '2026-08-29T10:00:00.000Z')).toBe(1);
  }));

});

describe('policyRefusalsSince', () => {

  test('returns policy refusals only, newest first', () => withLedger(ledger => {
    const policy = recordAttempt(ledger, attempt({ prompt: 'refused thing' }), new Date('2026-08-29T10:00:00Z'));
    settleAttempt(ledger, policy.id, settlement({ outcome: 'policy_refused', imageCount: 0 }));

    const capped = recordAttempt(ledger, attempt({ prompt: 'capped thing' }), new Date('2026-08-29T11:00:00Z'));
    settleAttempt(ledger, capped.id, settlement({ outcome: 'refused', imageCount: 0 }));

    const rows = policyRefusalsSince(ledger, '2026-08-29T00:00:00.000Z', 'openai');
    expect(rows.map(entry => entry.prompt)).toEqual(['refused thing']);
  }));

  test('respects the window and the limit', () => withLedger(ledger => {
    for (const hour of [1, 2, 3]) {
      const written = recordAttempt(ledger, attempt({ prompt: `thing ${String(hour)}` }),
                                    new Date(`2026-08-29T0${String(hour)}:00:00Z`));
      settleAttempt(ledger, written.id, settlement({ outcome: 'policy_refused', imageCount: 0 }));
    }
    expect(policyRefusalsSince(ledger, '2026-08-29T00:00:00.000Z', 'openai')).toHaveLength(3);
    expect(policyRefusalsSince(ledger, '2026-08-29T02:30:00.000Z', 'openai')).toHaveLength(1);
    expect(policyRefusalsSince(ledger, '2026-08-29T00:00:00.000Z', 'openai', 2)).toHaveLength(2);
  }));

  test("one provider's refusal is not another provider's, because a policy belongs to a vendor",
    () => withLedger(ledger => {
      const hosted = recordAttempt(ledger, attempt({ provider: 'openai', prompt: 'a contested scene' }),
                                   new Date('2026-08-29T10:00:00Z'));
      settleAttempt(ledger, hosted.id, settlement({ outcome: 'policy_refused', imageCount: 0 }));

      expect(policyRefusalsSince(ledger, '2026-08-29T00:00:00.000Z', 'openai')).toHaveLength(1);
      expect(policyRefusalsSince(ledger, '2026-08-29T00:00:00.000Z', 'automatic1111')).toHaveLength(0);
      expect(policyRefusalsSince(ledger, '2026-08-29T00:00:00.000Z', 'nanobanana')).toHaveLength(0);
    }));

});

describe('markAbandoned — the row that stays pending on purpose', () => {

  test('notes the abandonment without settling, so the outcome stays pending', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    markAbandoned(ledger, written.id, 'abandoned after 5000ms without an answer');

    const row = ledger.db.prepare('SELECT * FROM generations WHERE id = ?').get(written.id);
    expect(row?.['outcome']).toBe('pending');
    expect(String(row?.['detail'])).toContain('abandoned');
    expect(row?.['settled_utc']).toBeNull();
  }));

  test('an abandoned attempt keeps counting against the caps — the whole point', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt(), new Date('2026-08-29T10:00:00Z'));
    markAbandoned(ledger, written.id, 'abandoned');
    expect(billableInSession(ledger, SESSION)).toBe(1);
    expect(billableSince(ledger, '2026-08-29T00:00:00.000Z')).toBe(1);
  }));

  test('a row that already settled keeps what it learned', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    settleAttempt(ledger, written.id, settlement({ outcome: 'generated', detail: 'it landed' }));
    markAbandoned(ledger, written.id, 'abandoned');

    const row = ledger.db.prepare('SELECT * FROM generations WHERE id = ?').get(written.id);
    expect(row?.['outcome']).toBe('generated');
    expect(row?.['detail']).toBe('it landed');
  }));

  test('the abandonment note is scrubbed like every other text column', () => withLedger(ledger => {
    const written = recordAttempt(ledger, attempt());
    markAbandoned(ledger, written.id, `abandoned while sending ${PATTERNED_KEY}`);
    const row = ledger.db.prepare('SELECT detail FROM generations WHERE id = ?').get(written.id);
    expect(String(row?.['detail'])).not.toContain(PATTERNED_KEY);
  }));

});

describe('spendSince', () => {

  test('sums the estimates in the window and nothing outside it', () => withLedger(ledger => {
    for (const day of ['28', '29']) {
      const written = recordAttempt(ledger, attempt(), new Date(`2026-08-${day}T10:00:00Z`));
      settleAttempt(ledger, written.id, settlement({ costEstimateUsd: 0.04 }));
    }
    expect(spendSince(ledger, '2026-08-29T00:00:00.000Z')).toBeCloseTo(0.04, 6);
    expect(spendSince(ledger, '2026-08-01T00:00:00.000Z')).toBeCloseTo(0.08, 6);
  }));

  test('an empty ledger has spent nothing rather than null', () => withLedger(ledger => {
    expect(spendSince(ledger, '2026-08-01T00:00:00.000Z')).toBe(0);
  }));

});

describe('lifecycle', () => {

  test('reopening an existing ledger keeps its rows', () => {
    const dir  = mkdtempSync(join(tmpdir(), 'se-image-reopen-')),
          path = join(dir, 'images.sqlite3');
    try {
      const first = openImageLedger(path);
      recordAttempt(first, attempt());
      closeImageLedger(first);

      const second = openImageLedger(path);
      expect(billableInSession(second, SESSION)).toBe(1);
      closeImageLedger(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('closing twice is safe', () => {
    const dir    = mkdtempSync(join(tmpdir(), 'se-image-close-')),
          ledger = openImageLedger(join(dir, 'images.sqlite3'));
    closeImageLedger(ledger);
    expect(() => { closeImageLedger(ledger); }).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

});
