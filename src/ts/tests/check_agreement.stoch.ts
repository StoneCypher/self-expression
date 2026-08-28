/**
 * Stochastic property tests: the validator and the schema's CHECK constraints agree.
 *
 * The two-layer defense (entries.validate in code, baked CHECKs in the DDL) is
 * doctrine here, bought with the measured 12%-drift lesson — and it only works if the
 * layers cannot drift apart. The property: for every vocabulary-constrained column
 * and any candidate value, the validator accepts exactly when a direct SQL insert
 * into the rebuilt table succeeds.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { openStore, closeStore } from '../channels/store.js';
import { validate }              from '../channels/entries.js';
import type { EntryInput }       from '../channels/entries.js';
import {
  CHANNELS, POSITIONS, DELTAS, TURNS, EFFORTS, STEMS,
  CONFIDENCE_GROUNDS, DIVERGENCE_KINDS, MODALITIES,
  FORECAST_OUTCOMES, SILENCE_KINDS, ANCHOR_KINDS,
} from '../channels/vocabulary.js';

/** One constrained field: its EntryInput key, its column, its vocabulary, and any
 *  extra input needed to keep the validator's cross-field rules out of the way. */
interface Constrained {
  readonly field  : string;
  readonly column : string;
  readonly vocab  : readonly string[];
  readonly extra  : Partial<EntryInput>;
}

const CONSTRAINED: readonly Constrained[] = [
  { field: 'channel',        column: 'channel',         vocab: CHANNELS,           extra: {} },
  { field: 'position',       column: 'position',        vocab: POSITIONS,          extra: {} },
  { field: 'delta',          column: 'delta',           vocab: DELTAS,             extra: {} },
  { field: 'turn',           column: 'turn',            vocab: TURNS,              extra: {} },
  { field: 'effort',         column: 'effort',          vocab: EFFORTS,            extra: {} },
  { field: 'stem',           column: 'stem',            vocab: STEMS,              extra: {} },
  { field: 'confidence',     column: 'confidence',      vocab: CONFIDENCE_GROUNDS, extra: {} },
  { field: 'divergenceKind', column: 'divergence_kind', vocab: DIVERGENCE_KINDS,   extra: {} },
  { field: 'modality',       column: 'modality',        vocab: MODALITIES,         extra: {} },
  { field: 'outcome',        column: 'outcome',         vocab: FORECAST_OUTCOMES,  extra: { correctsId: 1 } },
  { field: 'silence',        column: 'silence',         vocab: SILENCE_KINDS,      extra: {} },
  // anchorKind carries a CHECK like the rest, plus cross-field rules of its own: the
  // extras are what keep those rules out of the way so the CHECK is what is compared.
  { field: 'anchorKind',     column: 'anchor_kind',     vocab: ANCHOR_KINDS,
    extra: { anchorTarget: 'src/x.ts', anchorQuote: 'const a = 1;' } },
];

/** Candidate values: genuine members, near-misses, historical drift, and noise. */
function valueArb(vocab: readonly string[]): fc.Arbitrary<string> {
  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...vocab) },
    { weight: 1, arbitrary: fc.constantFrom(...vocab.map(v => v.toUpperCase())) },
    { weight: 1, arbitrary: fc.constantFrom(...vocab.map(v => `${v} `)) },
    { weight: 1, arbitrary: fc.constantFrom('flat', 'right', 'vibes', 'quiet', 'won', '') },
    { weight: 1, arbitrary: fc.string({ maxLength: 12 }) },
  );
}

const caseArb = fc.integer({ min: 0, max: CONSTRAINED.length - 1 })
  .chain(index => {
    const c = CONSTRAINED[index] as Constrained;
    return valueArb(c.vocab).map(value => ({ c, value }));
  });

describe('validator vs CHECK agreement — stochastic', () => {

  it('accepts and rejects in lockstep for every constrained column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'se-agree-stoch-')),
          s   = openStore(join(dir, 'log.sqlite3'));
    let   n   = 0;

    try {
      fc.assert(
        fc.property(caseArb, ({ c, value }) => {

          n += 1;

          const input = {
            channel : c.field === 'channel' ? value : 'signature',
            text    : 'x',
            session : 's',
            ...c.extra,
            ...(c.field === 'channel' ? {} : { [c.field]: value }),
          } as EntryInput;

          const validatorAccepts = validate(input).length === 0;

          let sqlAccepts = true;
          try {
            if (c.column === 'channel') {
              s.db.prepare(
                `INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version)
                 VALUES (?, 't', 't', 't', 's', ?, 'x', '0')`).run(`agree-${String(n)}`, value);
            } else {
              s.db.prepare(
                `INSERT INTO entries (uuid, ts_utc, ts_local, tz, session, channel, text, plugin_version, ${c.column})
                 VALUES (?, 't', 't', 't', 's', 'signature', 'x', '0', ?)`).run(`agree-${String(n)}`, value);
            }
          } catch {
            sqlAccepts = false;
          }

          expect(validatorAccepts).toBe(sqlAccepts);

        }),
        { numRuns: 400 }
      );
    } finally {
      closeStore(s);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

});
