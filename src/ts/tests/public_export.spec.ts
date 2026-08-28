/**
 * Unit tests for the public-aggregation boundary (issue #31): totality against the
 * DDL, the pure treatment functions, the opt-in gate, and preview identity.
 *
 * The totality test is the load-bearing one — it is what makes the allowlist fail
 * safe forever: a future `entries` column breaks the build here until someone
 * classifies it in `PUBLIC_TREATMENTS`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig, readConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { recordEntry } from '../channels/entries.js';
import { anchorHash }  from '../channels/anchors.js';
import { ENTRIES_DDL } from '../channels/schema.js';
import {
  PUBLIC_TREATMENTS, CC_TYPES,
  coarsenTimestamp, pow2Bucket, capCount, majorVersion, saltedHash, freshSalt,
  localClockHour, localPeriod, localDow, closedOrNull, singleEmoji,
  shareWindow, exportPublicRows, previewPublicExport,
} from '../channels/public_export.js';
import { handleConfigure } from '../mcp/tools.js';

const OPTS = { granularity: 'hour', pluginVersion: '0.0.0-test' } as const;

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-pubexp-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

/** Opt the store in with a pinned moment, bypassing the configure event for window tests. */
function optIn(s: Store, momentUtc: string): void {
  writeConfig(s, 'share.enabled', 'true');
  writeConfig(s, 'share.opted_in_utc', momentUtc);
}

/** The column names of the entries table, parsed from the DDL the database executes. */
function ddlColumns(): string[] {
  return [...ENTRIES_DDL.matchAll(/^\s+([a-z_]+)\s+(?:INTEGER|TEXT)/gm)].map(m => m[1] ?? '');
}

describe('totality — the allowlist covers the whole schema, forever', () => {

  test('every column named in ENTRIES_DDL appears in PUBLIC_TREATMENTS exactly once', () => {
    const columns = ddlColumns();
    expect(columns.length).toBeGreaterThan(40);   // the parse itself must not silently die
    for (const column of columns) {
      expect(PUBLIC_TREATMENTS[column], `schema column '${column}' is unclassified — add it to PUBLIC_TREATMENTS before it can ship`).toBeDefined();
    }
  });

  test('no treatment names a column the schema no longer has', () => {
    const columns = new Set(ddlColumns());
    for (const key of Object.keys(PUBLIC_TREATMENTS)) {
      expect(columns.has(key), `treatment '${key}' names no schema column`).toBe(true);
    }
  });

  test('the classification counts match the spec plus the classified v2 and anchor columns: 25 verbatim, 11 coarsen, 8 hash, 3 derive, 15 excluded', () => {
    const counts: Record<string, number> = {};
    for (const treatment of Object.values(PUBLIC_TREATMENTS)) {
      counts[treatment.kind] = (counts[treatment.kind] ?? 0) + 1;
    }
    expect(counts).toEqual({ verbatim: 25, coarsen: 11, hash: 8, derive: 3, excluded: 15 });
  });

  test('the free-text and identifier columns are excluded or blinded, by name', () => {
    for (const column of ['text', 'title', 'cwd', 'project', 'git_branch', 'tz', 'agent_type',
                          'context_emoji', 'permission_mode', 'turn_index', 'id', 'resolve_by']) {
      expect(PUBLIC_TREATMENTS[column]?.kind).toBe('excluded');
    }
    for (const column of ['uuid', 'session', 'prompt_id', 'machine_id', 'agent_id', 'series_key', 'corrects_id']) {
      expect(PUBLIC_TREATMENTS[column]?.kind).toBe('hash');
    }
  });

  test('#18: the anchor kind is structured and exports, the quote and target never do', () => {
    expect(PUBLIC_TREATMENTS['anchor_kind']?.kind).toBe('verbatim');
    for (const column of ['anchor_quote', 'anchor_target', 'anchor_span']) {
      expect(PUBLIC_TREATMENTS[column]?.kind).toBe('excluded');
    }
  });

  test("#18: the anchor hash is re-blinded per submission — an unsalted content digest is a global join key", () => {
    expect(PUBLIC_TREATMENTS['anchor_hash']?.kind).toBe('hash');
  });

});

describe('coarsenTimestamp', () => {

  test('hour keeps the hour, day keeps the date, both drop everything finer', () => {
    expect(coarsenTimestamp('2026-08-18T16:14:09.123Z', 'hour')).toBe('2026-08-18T16:00:00Z');
    expect(coarsenTimestamp('2026-08-18T16:14:09.123Z', 'day')).toBe('2026-08-18');
  });

  test('an unrecognizable timestamp fails to null rather than leaking as-is', () => {
    expect(coarsenTimestamp('yesterday-ish', 'hour')).toBeNull();
    expect(coarsenTimestamp('', 'day')).toBeNull();
  });

});

describe('pow2Bucket', () => {

  test.each([[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [8, 3], [9, 4], [1024, 10], [1025, 11]])(
    'buckets %i into index %i', (value, bucket) => {
      expect(pow2Bucket(value)).toBe(bucket);
    });

  test('negatives clamp to bucket 0 — the exporter must not fail open on odd data', () => {
    expect(pow2Bucket(-5)).toBe(0);
  });

});

describe('capCount', () => {

  test.each([[0, 0], [7, 7], [32, 32]])('passes %i through as %i', (value, out) => {
    expect(capCount(value)).toBe(out);
  });

  test("collapses the identifying tail into '33+'", () => {
    expect(capCount(33)).toBe('33+');
    expect(capCount(4096)).toBe('33+');
  });

  test('clamps negatives to 0', () => {
    expect(capCount(-1)).toBe(0);
  });

});

describe('majorVersion', () => {

  test('keeps only the leading major digits', () => {
    expect(majorVersion('2.0.14')).toBe('2');
    expect(majorVersion('18')).toBe('18');
  });

  test('a non-digits-first version fails safe to null', () => {
    expect(majorVersion('v2.0.14')).toBeNull();
    expect(majorVersion('')).toBeNull();
  });

});

describe('saltedHash', () => {

  test('equal inputs hash equal under one salt; the output is 128 bits of hex', () => {
    const salt = freshSalt();
    expect(saltedHash(salt, 'session-a')).toBe(saltedHash(salt, 'session-a'));
    expect(saltedHash(salt, 'session-a')).toMatch(/^[0-9a-f]{32}$/);
  });

  test('different salts and different inputs both change the digest', () => {
    const a = freshSalt(), b = freshSalt();
    expect(saltedHash(a, 'x')).not.toBe(saltedHash(b, 'x'));
    expect(saltedHash(a, 'x')).not.toBe(saltedHash(a, 'y'));
  });

  test('a degenerate salt throws rather than producing a dictionary-attackable label', () => {
    expect(() => saltedHash(new Uint8Array(4), 'x')).toThrow(/16 bytes/);
  });

  test('freshSalt is 32 bytes and never repeats', () => {
    const a = freshSalt();
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(freshSalt()))).toBe(false);
  });

});

describe('local clock derivations', () => {

  test.each([['12:03 am PDT', 0], ['9:14 am PDT', 9], ['12:00 pm UTC', 12], ['11:59 pm CET', 23]])(
    'localClockHour(%s) => %i', (rendered, hour) => {
      expect(localClockHour(rendered)).toBe(hour);
    });

  test('rejects hours outside the 12-hour clock and unparseable renderings', () => {
    expect(localClockHour('13:00 am X')).toBeNull();
    expect(localClockHour('0:30 am X')).toBeNull();
    expect(localClockHour('garbage')).toBeNull();
  });

  test.each([
    ['12:00 am Z', 'night'], ['5:59 am Z', 'night'],
    ['6:00 am Z', 'morning'], ['11:59 am Z', 'morning'],
    ['12:00 pm Z', 'afternoon'], ['5:59 pm Z', 'afternoon'],
    ['6:00 pm Z', 'evening'], ['11:59 pm Z', 'evening'],
  ])('localPeriod(%s) => %s — six-hour band edges', (rendered, period) => {
    expect(localPeriod(rendered)).toBe(period);
  });

  test('localPeriod fails to null on prose', () => {
    expect(localPeriod('around lunchtime')).toBeNull();
  });

  test('localDow reconstructs the local calendar day from the clock difference', () => {
    // 2026-08-22 is a Saturday; 03:00 PDT is UTC-7 from 10:00Z the same day.
    expect(localDow('2026-08-22T10:00:00.000Z', '3:00 am PDT')).toBe('weekend');
    expect(localDow('2026-08-24T10:00:00.000Z', '3:00 am PDT')).toBe('weekday');
  });

  test('localDow crosses the date line in both directions', () => {
    // Sunday 02:00Z at UTC-7 is still Saturday evening locally.
    expect(localDow('2026-08-23T02:00:00.000Z', '7:00 pm PDT')).toBe('weekend');
    // Friday 22:00Z at +11 is already Saturday morning locally.
    expect(localDow('2026-08-21T22:00:00.000Z', '9:00 am AEDT')).toBe('weekend');
  });

  test('localDow fails to null when either side is unparseable', () => {
    expect(localDow('garbage', '9:00 am PDT')).toBeNull();
    expect(localDow('2026-08-22T10:00:00.000Z', 'garbage')).toBeNull();
  });

});

describe('export-time validators', () => {

  test('closedOrNull keeps only exact members of the closed list', () => {
    expect(closedOrNull(CC_TYPES, 'feat')).toBe('feat');
    expect(closedOrNull(CC_TYPES, 'feat: add thing')).toBeNull();
    expect(closedOrNull(CC_TYPES, 7)).toBeNull();
    expect(closedOrNull(CC_TYPES, null)).toBeNull();
  });

  test('singleEmoji accepts exactly one emoji grapheme, ZWJ sequences and skin tones included', () => {
    expect(singleEmoji('🙂')).toBe('🙂');
    expect(singleEmoji('👍🏽')).toBe('👍🏽');
    expect(singleEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧');
  });

  test('singleEmoji rejects prose, pairs, mixes, and non-strings', () => {
    expect(singleEmoji('ok')).toBeNull();
    expect(singleEmoji('🙂🙂')).toBeNull();
    expect(singleEmoji('🙂!')).toBeNull();
    expect(singleEmoji('a')).toBeNull();
    expect(singleEmoji('')).toBeNull();
    expect(singleEmoji(7)).toBeNull();
  });

});

describe('the opt-in gate', () => {

  test('a fresh install exports nothing: off by default, no opt-in moment', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'private', session: 's1' }, '0.0.0');
    expect(shareWindow(s)).toEqual({ enabled: false, optedInUtc: null });
    const doc = exportPublicRows(s, freshSalt(), OPTS);
    expect(doc.meta.share_enabled).toBe(false);
    expect(doc.rows).toEqual([]);
  }));

  test('only the exact string true enables — any other stored value means no', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1' }, '0.0.0');
    for (const nonAffirmative of ['yes', '1', 'TRUE', 'True', 'on', '']) {
      writeConfig(s, 'share.enabled', nonAffirmative);
      expect(shareWindow(s).enabled).toBe(false);
      expect(exportPublicRows(s, freshSalt(), OPTS).rows).toEqual([]);
    }
  }));

  test('enabled with no opt-in moment on record still exports nothing — both facts are required', () => withStore(s => {
    writeConfig(s, 'share.enabled', 'true');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1' }, '0.0.0');
    const doc = exportPublicRows(s, freshSalt(), OPTS);
    expect(doc.meta.share_enabled).toBe(false);
    expect(doc.rows).toEqual([]);
  }));

  test('rows recorded before the most recent opt-in are permanently outside the export', () => withStore(s => {
    recordEntry(s, { channel: 'signature', text: 'before', session: 's1', stem: 'drag' }, '0.0.0',
                new Date('2024-06-01T12:00:00Z'));
    recordEntry(s, { channel: 'signature', text: 'after', session: 's1', stem: 'flow' }, '0.0.0',
                new Date('2026-06-01T12:00:00Z'));
    optIn(s, '2025-01-01T00:00:00.000Z');
    const doc = exportPublicRows(s, freshSalt(), OPTS);
    expect(doc.meta.row_count).toBe(1);
    expect(doc.rows[0]?.['stem']).toBe('flow');
  }));

  test('an unparseable stored opt-in moment behaves as no opt-in at all', () => withStore(s => {
    writeConfig(s, 'share.enabled', 'true');
    writeConfig(s, 'share.opted_in_utc', 'whenever');   // hand-edited database
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1' }, '0.0.0');
    expect(exportPublicRows(s, freshSalt(), OPTS).rows).toEqual([]);
  }));

});

describe('the configure opt-in event', () => {

  test('setting share.enabled true stamps the opt-in moment once and keeps it on re-set', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'true' });
    const moment = readConfig(s, 'share.opted_in_utc');
    expect(moment).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'true' });
    expect(readConfig(s, 'share.opted_in_utc')).toBe(moment);
  }));

  test('setting share.enabled false clears the moment — opting out clears eligibility', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'true' });
    const out = handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'false' });
    expect(readConfig(s, 'share.opted_in_utc')).toBeNull();
    expect(out.content[0]?.text).toContain('cleared');
  }));

  test('a re-opt-in starts a fresh window, forfeiting the earlier one', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'true' });
    const first = readConfig(s, 'share.opted_in_utc');
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'false' });
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'true' });
    const second = readConfig(s, 'share.opted_in_utc');
    expect(second).not.toBeNull();
    expect(second === null || first === null || second >= first).toBe(true);
  }));

  test('unsetting share.enabled also clears the moment', () => withStore(s => {
    handleConfigure(s, { op: 'set', key: 'share.enabled', value: 'true' });
    handleConfigure(s, { op: 'unset', key: 'share.enabled' });
    expect(readConfig(s, 'share.enabled')).toBeNull();
    expect(readConfig(s, 'share.opted_in_utc')).toBeNull();
  }));

});

describe('the shaped rows', () => {

  test('no excluded column name appears as a field, and every derived field does', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, {
      channel: 'signature', text: 'the prose', session: 's1', title: 'client name',
      cwd: '/home/me/acme-corp', project: 'acme', gitBranch: 'feat/secret-product',
      agentType: 'acme-reviewer', permissionMode: 'acceptEdits', face: '🙂',
      cctype: 'feat', contextEmoji: '🌊🌊', turnIndex: 7, seriesKey: 'series-name',
    }, '0.0.0');
    const doc  = exportPublicRows(s, freshSalt(), OPTS),
          keys = Object.keys(doc.rows[0] ?? {});
    for (const banned of ['id', 'text', 'title', 'cwd', 'project', 'git_branch', 'tz',
                          'ts_local', 'agent_type', 'context_emoji', 'permission_mode',
                          'turn_index', 'corrects_id', 'resolve_by']) {
      expect(keys).not.toContain(banned);
    }
    for (const derived of ['local_period', 'local_dow', 'is_subagent', 'corrects_uuid', 'cctype', 'face']) {
      expect(keys).toContain(derived);
    }
  }));

  test('hashes blind the identifiers while keeping within-submission grouping', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'a', session: 'shared-session', seriesKey: 'k' }, '0.0.0');
    recordEntry(s, { channel: 'need',      text: 'b', session: 'shared-session', seriesKey: 'k' }, '0.0.0');
    const salt      = freshSalt(),
          doc       = exportPublicRows(s, salt, OPTS),
          [a, b]    = doc.rows;
    expect(a?.['session']).toBe(b?.['session']);
    expect(a?.['session']).toBe(saltedHash(salt, 'shared-session'));
    expect(a?.['series_key']).toBe(saltedHash(salt, 'k'));
    expect(a?.['uuid']).not.toBe(b?.['uuid']);
  }));

  test('corrects_uuid is the salted hash of the target row\'s uuid, never the local rowid', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    const target = recordEntry(s, { channel: 'signature', text: 'original', session: 's1' }, '0.0.0');
    recordEntry(s, { channel: 'divergence', text: 'retraction', session: 's1', correctsId: target.id }, '0.0.0');
    const salt = freshSalt(),
          doc  = exportPublicRows(s, salt, OPTS),
          edge = doc.rows.find(r => r['corrects_uuid'] !== null);
    expect(edge?.['corrects_uuid']).toBe(saltedHash(salt, target.uuid));
  }));

  test('#18: an anchored row exports its kind and a blinded hash, and no anchor words at all', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'dissent', text: 'ambiguous', session: 's1',
                     anchorKind: 'prompt', anchorTarget: 'p-secret-7',
                     anchorQuote: 'the clients internal codename' }, '0.0.0');
    const salt = freshSalt(),
          row  = exportPublicRows(s, salt, OPTS).rows[0] ?? {},
          keys = Object.keys(row);
    expect(row['anchor_kind']).toBe('prompt');
    for (const banned of ['anchor_quote', 'anchor_target', 'anchor_span']) {
      expect(keys).not.toContain(banned);
    }
    expect(JSON.stringify(row)).not.toContain('codename');
    expect(JSON.stringify(row)).not.toContain('p-secret-7');
    expect(row['anchor_hash']).toBe(saltedHash(salt, anchorHash('the clients internal codename')));
  }));

  test('#18: two notes quoting the same thing group together inside one submission', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    for (const channel of ['dissent', 'confidence'] as const) {
      recordEntry(s, { channel, text: 'about the same line', session: 's1',
                       anchorKind: 'file', anchorTarget: 'a.ts', anchorSpan: 'L1',
                       anchorQuote: 'const answer = 42;' }, '0.0.0');
    }
    const [a, b] = exportPublicRows(s, freshSalt(), OPTS).rows;
    expect(a?.['anchor_hash']).toBe(b?.['anchor_hash']);
  }));

  test('#18: an unanchored row exports nulls, not absent keys — the shape is uniform', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'floating', session: 's1' }, '0.0.0');
    const row = exportPublicRows(s, freshSalt(), OPTS).rows[0] ?? {};
    expect(row['anchor_kind']).toBeNull();
    expect(row['anchor_hash']).toBeNull();
  }));

  test('the open product names are capped at 64 characters as an abuse valve', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1', model: 'm'.repeat(100) }, '0.0.0');
    const doc = exportPublicRows(s, freshSalt(), OPTS);
    expect(doc.rows[0]?.['model']).toBe('m'.repeat(64));
  }));

  test('an off-list cctype and a prose face export as null, not as themselves', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1',
                     cctype: 'feat: smuggled prose', face: 'not an emoji' }, '0.0.0');
    const row = exportPublicRows(s, freshSalt(), OPTS).rows[0];
    expect(row?.['cctype']).toBeNull();
    expect(row?.['face']).toBeNull();
  }));

  test('counters are coarsened: pow2 buckets and the 33+ ceiling, timestamps to the hour or day', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1',
                     promptLen: 1000, toolCalls: 61, errorCount: 3, hostVersion: '2.0.14' }, '0.0.0',
                new Date('2026-08-18T16:14:09.123Z'));
    const hourRow = exportPublicRows(s, freshSalt(), OPTS).rows[0];
    expect(hourRow?.['prompt_len']).toBe(10);
    expect(hourRow?.['tool_calls']).toBe('33+');
    expect(hourRow?.['error_count']).toBe(3);
    expect(hourRow?.['host_version']).toBe('2');
    expect(hourRow?.['ts_utc']).toBe('2026-08-18T16:00:00Z');
    const dayRow = exportPublicRows(s, freshSalt(), { ...OPTS, granularity: 'day' }).rows[0];
    expect(dayRow?.['ts_utc']).toBe('2026-08-18');
  }));

  test('the meta block carries provenance, options, and a coarsened export timestamp', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1' }, '0.0.0');
    const doc = exportPublicRows(s, freshSalt(), { ...OPTS, now: new Date('2026-08-28T09:30:00Z') });
    expect(doc.meta.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.meta.plugin_version).toBe('0.0.0-test');
    expect(doc.meta.time_granularity).toBe('hour');
    expect(doc.meta.exported).toBe('2026-08-28T09:00:00Z');
    expect(doc.meta.share_enabled).toBe(true);
    expect(doc.meta.row_count).toBe(doc.rows.length);
  }));

  test('a degenerate salt is refused before any row is read', () => withStore(s => {
    expect(() => exportPublicRows(s, new Uint8Array(0), OPTS)).toThrow(/16 bytes/);
  }));

});

describe('preview identity — the preview IS the export', () => {

  test('the preview document\'s rows are byte-identical to exportPublicRows under the same salt and options', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'x', session: 's1', stem: 'flow', face: '🙂' }, '0.0.0');
    recordEntry(s, { channel: 'need', text: 'y', session: 's1' }, '0.0.0');
    const salt    = freshSalt(),
          now     = new Date('2026-08-28T09:30:00Z'),
          preview = previewPublicExport(s, { ...OPTS, now }, salt),
          direct  = exportPublicRows(s, salt, { ...OPTS, now });
    expect(JSON.stringify(preview.document.rows)).toBe(JSON.stringify(direct.rows));
    expect(preview.document.meta.row_count).toBe(direct.meta.row_count);
  }));

  test('the rendered preview names every column with its disposition, plus the gate state', () => withStore(s => {
    const preview = previewPublicExport(s, OPTS);
    for (const [column, treatment] of Object.entries(PUBLIC_TREATMENTS)) {
      expect(preview.rendered).toContain(column);
      expect(preview.rendered).toContain(treatment.kind);
    }
    expect(preview.rendered).toContain('sharing     : off');
  }));

  test('the rendered sample carries the export\'s actual field values', () => withStore(s => {
    optIn(s, '2020-01-01T00:00:00.000Z');
    recordEntry(s, { channel: 'signature', text: 'the secret prose', session: 's1', stem: 'spark' }, '0.0.0');
    const preview = previewPublicExport(s, OPTS);
    expect(preview.rendered).toContain('"spark"');
    expect(preview.rendered).not.toContain('the secret prose');
  }));

});
