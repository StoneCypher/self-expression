import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { openStore, closeStore, writeConfig } from '../channels/store.js';
import type { Store } from '../channels/store.js';
import { openLedger, closeLedger, recordStrike } from '../claudio/ledger.js';
import type { AudioLedger } from '../claudio/ledger.js';
import { handleStrike, handleSay, newAudioSession } from '../claudio/tools.js';
import type { AudioDeps, AudioSession } from '../claudio/tools.js';
import type { PlayerCommand, PlayOutcome } from '../claudio/player.js';
import { MAX_SAY_CHARS } from '../claudio/player.js';
import { encodeWavPcm16 } from '../claudio/synth.js';
import {
  AUDIO_ENABLED_KEY, AUDIO_TTS_LOCAL_KEY, AUDIO_MIN_GAP_KEY, AUDIO_HOURLY_BUDGET_KEY, motifWavKey,
} from '../claudio/config.js';
import { LEITMOTIFS } from '../claudio/vocabulary.js';

const VERSION = '0.0.0-test';

interface Rig {
  readonly store    : Store;
  readonly ledger   : AudioLedger;
  readonly deps     : AudioDeps;
  readonly session  : AudioSession;
  readonly played   : { command: PlayerCommand; capMs: number }[];
  readonly assetDir : string;
}

/** A short valid PCM16 WAV — 400 samples at 8 kHz is 50 ms. */
function tinyWav(samples = 400): Uint8Array {
  return encodeWavPcm16(Array.from({ length: samples }, (_, i) => Math.sin(i / 10) * 0.5), 8000);
}

/**
 * A full rig: real store, real ledger, real vendored-style assets in a temp dir,
 * and a fake player that records what would have been spawned. No sound can play.
 */
async function withRig<T>(
  fn          : (rig: Rig) => Promise<T> | T,
  playOutcome : PlayOutcome = { ok: true, capped: false, detail: null },
): Promise<T> {

  const dir      = mkdtempSync(join(tmpdir(), 'se-claudio-tools-')),
        assetDir = join(dir, 'assets');
  mkdirSync(assetDir);
  for (const leitmotif of LEITMOTIFS) { writeFileSync(join(assetDir, `${leitmotif}.wav`), tinyWav()); }

  const store  = openStore(join(dir, 'log.sqlite3')),
        ledger = openLedger(join(dir, 'audio.sqlite3')),
        played: { command: PlayerCommand; capMs: number }[] = [];

  writeConfig(store, AUDIO_ENABLED_KEY, 'true');

  const deps: AudioDeps = {
    assetDir,
    env  : {},
    play : (command, capMs) => { played.push({ command, capMs }); return Promise.resolve(playOutcome); },
  };

  try { return await fn({ store, ledger, deps, session: newAudioSession(), played, assetDir }); }
  finally { closeStore(store); closeLedger(ledger); rmSync(dir, { recursive: true, force: true }); }

}

function lastRow(ledger: AudioLedger): Record<string, unknown> {
  return ledger.db.prepare('SELECT * FROM strikes ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
}

describe('handleStrike — the happy path', () => {

  test('plays, ledgers, and reports volume, ceiling, and row id', () => withRig(async rig => {
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'spark' });
    expect(out.content[0]?.text).toBe("struck 'spark' at volume 25 (ceiling 50) — ledger #1");

    expect(rig.played).toHaveLength(1);
    expect(rig.played[0]?.command.exe).toBe('powershell');
    expect(rig.played[0]?.command.args[5]).toMatch(/SoundPlayer '.*claudio-.*\.wav'\)\.PlaySync\(\)/);
    expect(rig.played[0]?.capMs).toBe(50 + 2000);   // 50 ms wav + margin

    const row = lastRow(rig.ledger);
    expect(row['outcome']).toBe('played');
    expect(row['kind']).toBe('strike');
    expect(row['leitmotif']).toBe('spark');
    expect(Number(row['played_volume'])).toBe(25);
    expect(Number(row['ceiling'])).toBe(50);
    expect(Number(row['duration_ms'])).toBe(50);
    expect(row['requested_volume']).toBeNull();
  }));

  test('the temp file the player saw is removed afterwards', () => withRig(async rig => {
    await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike', { leitmotif: 'spark' });
    const arg  = rig.played[0]?.command.args[5] ?? '',
          path = /'(.*)'/.exec(arg)?.[1] ?? '';
    expect(path).not.toBe('');
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(tmpdir()).filter(f => f === path.split(/[\\/]/).pop()).length).toBe(0);
  }));

  test('an explicit volume is honoured under the ceiling and clamped over it', () => withRig(async rig => {
    const soft = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                    { leitmotif: 'spark', volume: 10 });
    expect(soft.content[0]?.text).toContain('at volume 10');

    writeConfig(rig.store, AUDIO_MIN_GAP_KEY, '0');
    const loud = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                    { leitmotif: 'spark', volume: 100 });
    expect(loud.content[0]?.text).toContain('at volume 50');
    expect(Number(lastRow(rig.ledger)['requested_volume'])).toBe(100);
  }));

  test('session-open plays once; the second attempt is refused and ledgered', () => withRig(async rig => {
    writeConfig(rig.store, AUDIO_MIN_GAP_KEY, '0');
    const first = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                     { leitmotif: 'session-open' });
    expect(first.content[0]?.text).toContain('struck');
    expect(rig.session.sessionOpenStruck).toBe(true);

    const second = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                      { leitmotif: 'session-open' });
    expect(second.content[0]?.text).toContain('error:');
    expect(second.content[0]?.text).toContain('once per session');
    expect(lastRow(rig.ledger)['outcome']).toBe('refused');
    expect(rig.played).toHaveLength(1);
  }));

});

describe('handleStrike — refusals and failures', () => {

  test('a disabled facility refuses per-strike, not per-session, and ledgers it', () => withRig(async rig => {
    writeConfig(rig.store, AUDIO_ENABLED_KEY, 'false');
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'attention' });
    expect(out.content[0]?.text).toContain("error: audio is disabled");
    expect(rig.played).toHaveLength(0);
    const row = lastRow(rig.ledger);
    expect(row['outcome']).toBe('refused');
    expect(Number(row['played_volume'])).toBe(0);
  }));

  test('the minimum gap refuses a second strike, and no player runs for it', () => withRig(async rig => {
    await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike', { leitmotif: 'spark' });
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'quiet-completion' });
    expect(out.content[0]?.text).toContain('minimum gap');
    expect(rig.played).toHaveLength(1);
  }));

  test('a missing waveform is refused with the path named', () => withRig(async rig => {
    writeConfig(rig.store, motifWavKey('spark'), join(rig.assetDir, 'nonesuch.wav'));
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'spark' });
    expect(out.content[0]?.text).toContain('error:');
    expect(out.content[0]?.text).toContain('nonesuch.wav');
    expect(rig.played).toHaveLength(0);
    expect(lastRow(rig.ledger)['outcome']).toBe('refused');
  }));

  test('a malformed replacement waveform is refused, never played at unknown volume', () => withRig(async rig => {
    const bad = join(rig.assetDir, 'bad.wav');
    writeFileSync(bad, new Uint8Array([1, 2, 3, 4, 5]));
    writeConfig(rig.store, motifWavKey('spark'), bad);
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'spark' });
    expect(out.content[0]?.text).toContain('unplayable waveform');
    expect(rig.played).toHaveLength(0);
  }));

  test('a waveform past the hard cap is refused — nothing loops, ever', () => withRig(async rig => {
    const long = join(rig.assetDir, 'long.wav');
    writeFileSync(long, encodeWavPcm16(new Float64Array(8000 * 11), 8000));   // 11 s
    writeConfig(rig.store, motifWavKey('spark'), long);
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'spark' });
    expect(out.content[0]?.text).toContain('hard cap');
    expect(rig.played).toHaveLength(0);
    expect(lastRow(rig.ledger)['outcome']).toBe('refused');
  }));

  test('a player failure is ledgered as an error, with the detail surfaced', () => withRig(async rig => {
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'spark' });
    expect(out.content[0]?.text).toContain('did not play');
    expect(out.content[0]?.text).toContain('player exited 1');
    const row = lastRow(rig.ledger);
    expect(row['outcome']).toBe('error');
    expect(String(row['detail'])).toBe('player exited 1');
  }, { ok: false, capped: false, detail: 'player exited 1' }));

  test('a failed session-open does not consume the once-per-session slot', () => withRig(async rig => {
    await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                       { leitmotif: 'session-open' });
    expect(rig.session.sessionOpenStruck).toBe(false);
  }, { ok: false, capped: false, detail: 'player exited 1' }));

});

describe('handleStrike — audition', () => {

  test('auditions play at the fixed low volume outside the strike gap', () => withRig(async rig => {
    await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike', { leitmotif: 'spark' });
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'audition',
                                   { leitmotif: 'attention' });
    expect(out.content[0]?.text).toContain("auditioned 'attention' at volume 20");
    expect(lastRow(rig.ledger)['kind']).toBe('audition');
    expect(rig.played).toHaveLength(2);
  }));

});

describe('handleSay', () => {

  function enableSay(rig: Rig): void {
    writeConfig(rig.store, AUDIO_TTS_LOCAL_KEY, 'true');
  }

  test('speaks through SAPI at the granted volume and ledgers the text locally', () => withRig(async rig => {
    enableSay(rig);
    const out = await handleSay(rig.store, rig.ledger, rig.deps, rig.session, VERSION,
                                { text: 'the build is green' });
    expect(out.content[0]?.text).toBe('said 18 characters at volume 25 (ceiling 50) — ledger #1');
    expect(rig.played[0]?.command.args[5]).toContain("$s.Speak('the build is green')");
    const row = lastRow(rig.ledger);
    expect(row['kind']).toBe('say');
    expect(row['text']).toBe('the build is green');
    expect(row['leitmotif']).toBeNull();
  }));

  test('the tier gate refuses when audio is on but tts_local is not exactly true', () => withRig(async rig => {
    const out = await handleSay(rig.store, rig.ledger, rig.deps, rig.session, VERSION, { text: 'hello' });
    expect(out.content[0]?.text).toContain('audio.tts_local');
    expect(rig.played).toHaveLength(0);
    expect(lastRow(rig.ledger)['outcome']).toBe('refused');
  }));

  test('empty text is refused before any gate spends budget', () => withRig(async rig => {
    enableSay(rig);
    const out = await handleSay(rig.store, rig.ledger, rig.deps, rig.session, VERSION, { text: '   ' });
    expect(out.content[0]?.text).toContain('non-empty');
    expect(rig.played).toHaveLength(0);
  }));

  test('over-long text is refused with the cap named', () => withRig(async rig => {
    enableSay(rig);
    const out = await handleSay(rig.store, rig.ledger, rig.deps, rig.session, VERSION,
                                { text: 'x'.repeat(MAX_SAY_CHARS + 1) });
    expect(out.content[0]?.text).toContain(String(MAX_SAY_CHARS));
    expect(rig.played).toHaveLength(0);
    expect(lastRow(rig.ledger)['outcome']).toBe('refused');
  }));

  test('say shares the audible rate limits with strikes', () => withRig(async rig => {
    enableSay(rig);
    await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike', { leitmotif: 'spark' });
    const out = await handleSay(rig.store, rig.ledger, rig.deps, rig.session, VERSION, { text: 'too soon' });
    expect(out.content[0]?.text).toContain('minimum gap');
    expect(rig.played).toHaveLength(1);
  }));

  test('a speech failure is ledgered as an error with the text preserved', () => withRig(async rig => {
    enableSay(rig);
    const out = await handleSay(rig.store, rig.ledger, rig.deps, rig.session, VERSION, { text: 'oops' });
    expect(out.content[0]?.text).toContain('did not play');
    const row = lastRow(rig.ledger);
    expect(row['outcome']).toBe('error');
    expect(row['text']).toBe('oops');
  }, { ok: false, capped: true, detail: 'killed at the 12000 ms hard cap' }));

});

describe('the rate-limit window is one rolling hour', () => {

  test('strikes older than an hour do not count against the budget', () => withRig(async rig => {
    // Six played strikes, all 61+ minutes old, then a fresh one: allowed.
    for (let i = 0; i < 6; i++) {
      recordStrike(rig.ledger, {
        kind: 'strike', leitmotif: 'spark', requestedVolume: null, playedVolume: 25,
        ceiling: 50, durationMs: 50, outcome: 'played', detail: null, text: null,
        pluginVersion: VERSION,
      }, new Date(Date.now() - (61 + i) * 60_000));
    }
    const out = await handleStrike(rig.store, rig.ledger, rig.deps, rig.session, VERSION, 'strike',
                                   { leitmotif: 'spark' });
    expect(out.content[0]?.text).toContain('struck');
  }));

});

describe('the rate-limit slot is reserved before the play — concurrent calls cannot all pass', () => {

  /**
   * Regression for the bug where the ledger only gained a row once `play()`
   * resolved: N concurrent calls all read the same empty ledger inside the gate
   * and all passed. `play` here resolves on a later macrotask (a real
   * `setTimeout`), so every concurrent call's synchronous "decide" phase runs
   * before any of them can possibly have recorded an outcome — exactly the window
   * the reservation in `reserveSlot` exists to close.
   */
  test('only the hourly budget worth of N concurrent strikes reach the player', () => withRig(async rig => {
    writeConfig(rig.store, AUDIO_MIN_GAP_KEY, '0');
    writeConfig(rig.store, AUDIO_HOURLY_BUDGET_KEY, '3');

    const FIXED = new Date('2026-08-31T12:00:00.000Z');
    let playCount = 0;
    const deps: AudioDeps = {
      assetDir : rig.assetDir,
      env      : {},
      now      : () => FIXED,
      play     : () => {
        playCount += 1;
        return new Promise(resolve => {
          setTimeout(() => resolve({ ok: true, capped: false, detail: null }), 0);
        });
      },
    };

    const attempts = 10,
          results  = await Promise.all(Array.from({ length: attempts }, () =>
            handleStrike(rig.store, rig.ledger, deps, rig.session, VERSION, 'strike', { leitmotif: 'spark' })));

    expect(playCount).toBe(3);
    expect(results.filter(r => r.content[0]?.text.startsWith('struck')).length).toBe(3);
    expect(results.filter(r => r.content[0]?.text.includes('hourly strike budget')).length).toBe(7);

    // Every reservation is released once its play resolves and the ledger row
    // takes over — nothing leaks past the burst.
    expect(rig.session.reservations).toHaveLength(0);

    const followUp = await handleStrike(rig.store, rig.ledger, deps, rig.session, VERSION, 'strike',
                                        { leitmotif: 'spark' });
    expect(followUp.content[0]?.text).toContain('hourly strike budget');
  }));

  test('an in-flight reservation counts against the minimum gap too', () => withRig(async rig => {
    writeConfig(rig.store, AUDIO_HOURLY_BUDGET_KEY, '10');   // budget is not the limiter here
    const FIXED = new Date('2026-08-31T12:00:00.000Z');
    const deps: AudioDeps = {
      assetDir : rig.assetDir,
      env      : {},
      now      : () => FIXED,
      play     : () => new Promise(resolve => {
        setTimeout(() => resolve({ ok: true, capped: false, detail: null }), 0);
      }),
    };

    const [first, second] = await Promise.all([
      handleStrike(rig.store, rig.ledger, deps, rig.session, VERSION, 'strike', { leitmotif: 'spark' }),
      handleStrike(rig.store, rig.ledger, deps, rig.session, VERSION, 'strike', { leitmotif: 'quiet-completion' }),
    ]);

    expect(first?.content[0]?.text).toContain('struck');
    expect(second?.content[0]?.text).toContain('minimum gap');
  }));

});
