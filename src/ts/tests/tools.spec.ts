import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store }                         from '../channels/store.js';
import { recordContext }                      from '../channels/context.js';
import { CHANNELS, CONFIDENCE_GROUNDS }       from '../channels/vocabulary.js';
import {
  enabledChannels, enabledConfidenceGrounds, handleExpress, ENABLED_KEY, FORECAST_KEY,
} from '../mcp/tools.js';

const VERSION = '0.2.0';

function withStore<T>(fn: (s: Store) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'se-tools-')),
        s   = openStore(join(dir, 'log.sqlite3'));
  try { return fn(s); } finally { closeStore(s); rmSync(dir, { recursive: true, force: true }); }
}

describe('enabledChannels', () => {

  test('defaults to every channel, including load and taste', () => withStore(s => {
    expect(enabledChannels(s)).toEqual(CHANNELS);
  }));

  test('an override narrows to the named channels', () => withStore(s => {
    writeConfig(s, ENABLED_KEY, 'signature, need, taste');
    expect(enabledChannels(s)).toEqual(['signature', 'need', 'taste']);
  }));

  test('an override naming nothing recognised is ignored, not obeyed', () => withStore(s => {
    writeConfig(s, ENABLED_KEY, 'vibes,zeal');
    expect(enabledChannels(s)).toEqual(CHANNELS);
  }));

});

describe('enabledConfidenceGrounds', () => {

  test('defaults to every ground, including predicted — forecast is on by default', () => withStore(s => {
    expect(enabledConfidenceGrounds(s)).toEqual(CONFIDENCE_GROUNDS);
  }));

  test("forecast.enabled = 'false' bakes predicted out of the enum entirely", () => withStore(s => {
    writeConfig(s, FORECAST_KEY, false);
    const grounds = enabledConfidenceGrounds(s);
    expect(grounds).toEqual(['verified', 'recalled', 'inferred', 'guessed']);
    expect(grounds).not.toContain('predicted');
  }));

  test('only the exact string false disables; anything else keeps the default on', () => withStore(s => {
    for (const value of ['off', 'no', '0', 'False', 'true']) {
      writeConfig(s, FORECAST_KEY, value);
      expect(enabledConfidenceGrounds(s)).toEqual(CONFIDENCE_GROUNDS);
    }
  }));

});

describe('handleExpress — forecasts', () => {

  test('records a forecast with its resolve-by date', () => withStore(s => {
    const w = handleExpress(s, VERSION, {
      channel: 'confidence', text: 'the stryker run passes untouched',
      confidence: 'predicted', resolveBy: '2026-08-30',
    });
    const row = s.db.prepare('SELECT confidence, resolve_by FROM entries WHERE id = ?').get(w.id);
    expect(row?.confidence).toBe('predicted');
    expect(row?.resolve_by).toBe('2026-08-30');
  }));

  test('records a resolution pointing back at the forecast', () => withStore(s => {
    const forecast = handleExpress(s, VERSION, {
      channel: 'confidence', text: 'lands by friday', confidence: 'predicted',
    });
    const resolution = handleExpress(s, VERSION, {
      channel: 'confidence', text: 'merged clean, no review comments',
      correctsId: forecast.id, outcome: 'hit',
    });
    const row = s.db.prepare('SELECT corrects_id, outcome FROM entries WHERE id = ?').get(resolution.id);
    expect(row?.corrects_id).toBe(forecast.id);
    expect(row?.outcome).toBe('hit');
  }));

  test("a resolution whose target is not a forecast is rejected, naming the target's actual ground", () => withStore(s => {
    const plain = handleExpress(s, VERSION, {
      channel: 'confidence', text: 'checked it', confidence: 'verified',
    });
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: plain.id, outcome: 'hit',
    })).toThrow(/'verified'/);
  }));

  test('a resolution whose target has no ground at all is rejected too', () => withStore(s => {
    const idea = handleExpress(s, VERSION, { channel: 'idea', text: 'what if' });
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: idea.id, outcome: 'miss',
    })).toThrow(/unset/);
  }));

  test('a resolution pointing at a nonexistent row is rejected, and nothing is written', () => withStore(s => {
    expect(() => handleExpress(s, VERSION, {
      channel: 'confidence', text: 'resolved?', correctsId: 999, outcome: 'void',
    })).toThrow(/does not exist/);
    expect(s.db.prepare('SELECT COUNT(*) n FROM entries').get().n).toBe(0);
  }));

});

describe('handleExpress — new channels and silence', () => {

  test('records a taste line', () => withStore(s => {
    const w = handleExpress(s, VERSION, {
      channel: 'taste', text: 'this fix is a load-bearing kludge and we both know it',
    });
    expect(s.db.prepare('SELECT channel FROM entries WHERE id = ?').get(w.id)?.channel).toBe('taste');
  }));

  test('records a load line', () => withStore(s => {
    const w = handleExpress(s, VERSION, {
      channel: 'load', text: 'context 72% full, 3 agents in flight, tool calls sluggish',
    });
    expect(s.db.prepare('SELECT channel FROM entries WHERE id = ?').get(w.id)?.channel).toBe('load');
  }));

  test('records a typed silence on a signature close', () => withStore(s => {
    const w = handleExpress(s, VERSION, {
      channel: 'signature', text: 'still; nothing notable', position: 'close', silence: 'empty',
    });
    expect(s.db.prepare('SELECT silence FROM entries WHERE id = ?').get(w.id)?.silence).toBe('empty');
  }));

});

describe('handleExpress — context adoption (unchanged by #42)', () => {

  test('adopts the hook-observed session, and marks no-hook when there is none', () => withStore(s => {
    const orphan = handleExpress(s, VERSION, { channel: 'idea', text: 'x' });
    expect(s.db.prepare('SELECT session FROM entries WHERE id = ?').get(orphan.id)?.session).toBe('no-hook');
    recordContext(s, { session: 'sess-9', promptId: 'p1' });
    const adopted = handleExpress(s, VERSION, { channel: 'idea', text: 'y' });
    const row = s.db.prepare('SELECT session, prompt_id FROM entries WHERE id = ?').get(adopted.id);
    expect(row?.session).toBe('sess-9');
    expect(row?.prompt_id).toBe('p1');
  }));

  test('the client identity lands as host and host_version', () => withStore(s => {
    const w = handleExpress(s, VERSION, { channel: 'idea', text: 'x' },
                            { name: 'claude-code', version: '2.0.1' });
    const row = s.db.prepare('SELECT host, host_version FROM entries WHERE id = ?').get(w.id);
    expect(row?.host).toBe('claude-code');
    expect(row?.host_version).toBe('2.0.1');
  }));

});
