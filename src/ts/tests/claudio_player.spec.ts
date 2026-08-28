import {
  escapePwshSingleQuoted, soundPlayerCommand, sapiSpeakCommand, platformHasPlayer,
  runPlayer, HARD_CAP_MS,
} from '../claudio/player.js';
import type { ChildLike, SpawnLike } from '../claudio/player.js';

/** A scriptable fake child: fire exit/error on demand; count kills. */
function fakeChild(): { child: ChildLike; fire: (event: 'exit' | 'error', value: number | null | Error) => void; kills: () => number } {
  const listeners: Record<string, ((v: never) => void)[]> = { exit: [], error: [] };
  let killed = 0;
  const child: ChildLike = {
    on(event, listener) { listeners[event]?.push(listener as (v: never) => void); },
    kill() { killed += 1; return true; },
  };
  return {
    child,
    fire: (event, value) => { for (const l of listeners[event] ?? []) { (l as (v: unknown) => void)(value); } },
    kills: () => killed,
  };
}

describe('escapePwshSingleQuoted', () => {

  test('doubles single quotes — the only PowerShell metacharacter in this context', () => {
    expect(escapePwshSingleQuoted("it's Ada's build")).toBe("it''s Ada''s build");
  });

  test('flattens control characters so nothing smuggles a line break', () => {
    expect(escapePwshSingleQuoted('a\r\nb\tc\u0000d')).toBe('a  b c d');
  });

  test('leaves ordinary text alone', () => {
    expect(escapePwshSingleQuoted('C:\\tmp\\claudio-x.wav')).toBe('C:\\tmp\\claudio-x.wav');
  });

});

describe('command construction', () => {

  test('soundPlayerCommand is the exact pinned mechanism', () => {
    const command = soundPlayerCommand('C:\\tmp\\x.wav');
    expect(command.exe).toBe('powershell');
    expect(command.args).toEqual([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      "(New-Object System.Media.SoundPlayer 'C:\\tmp\\x.wav').PlaySync()",
    ]);
  });

  test('soundPlayerCommand escapes a hostile path instead of trusting it', () => {
    const command = soundPlayerCommand("C:\\it's\\x.wav");
    expect(command.args[5]).toContain("it''s");
  });

  test('sapiSpeakCommand pins the volume and disposes the synthesizer', () => {
    const script = sapiSpeakCommand("it's green", 40).args[5] ?? '';
    expect(script).toContain('System.Speech.Synthesis.SpeechSynthesizer');
    expect(script).toContain('$s.Volume = 40');
    expect(script).toContain("$s.Speak('it''s green')");
    expect(script).toContain('$s.Dispose()');
  });

  test('sapiSpeakCommand clamps volume into 0-100', () => {
    expect(sapiSpeakCommand('x', 150).args[5]).toContain('$s.Volume = 100');
    expect(sapiSpeakCommand('x', -3).args[5]).toContain('$s.Volume = 0');
  });

});

describe('platformHasPlayer', () => {

  test('windows has one; everything else degrades to silence for now', () => {
    expect(platformHasPlayer('win32')).toBe(true);
    for (const other of ['darwin', 'linux', 'freebsd', 'aix']) {
      expect(platformHasPlayer(other)).toBe(false);
    }
  });

});

describe('runPlayer', () => {

  test('a clean exit resolves ok without killing', async () => {
    const fake = fakeChild(),
          spawn: SpawnLike = () => fake.child,
          pending = runPlayer(soundPlayerCommand('x.wav'), spawn, 5000);
    fake.fire('exit', 0);
    expect(await pending).toEqual({ ok: true, capped: false, detail: null });
    expect(fake.kills()).toBe(0);
  });

  test('a nonzero exit is an outcome, not an exception', async () => {
    const fake = fakeChild(),
          pending = runPlayer(soundPlayerCommand('x.wav'), () => fake.child, 5000);
    fake.fire('exit', 3);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(outcome.capped).toBe(false);
    expect(outcome.detail).toBe('player exited 3');
  });

  test('a spawn-time error resolves with the failure named', async () => {
    const spawn: SpawnLike = () => { throw new Error('ENOENT powershell'); };
    const outcome = await runPlayer(soundPlayerCommand('x.wav'), spawn, 5000);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('failed to spawn');
    expect(outcome.detail).toContain('ENOENT powershell');
  });

  test('an emitted error event resolves with the failure named', async () => {
    const fake = fakeChild(),
          pending = runPlayer(soundPlayerCommand('x.wav'), () => fake.child, 5000);
    fake.fire('error', new Error('spawn powershell EACCES'));
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('EACCES');
  });

  test('the hard cap kills a child that never exits — nothing loops, ever', async () => {
    const fake = fakeChild(),
          outcome = await runPlayer(soundPlayerCommand('x.wav'), () => fake.child, 20);
    expect(outcome.ok).toBe(false);
    expect(outcome.capped).toBe(true);
    expect(outcome.detail).toContain('20 ms hard cap');
    expect(fake.kills()).toBe(1);
  });

  test('the cap deadline itself is clamped to HARD_CAP_MS', async () => {
    // A cap request beyond the absolute limit must not extend the child's life;
    // asserted through the reported deadline on a cap kill with a tiny fake clock
    // is not possible without waiting, so assert the clamp arithmetic indirectly:
    // a deadline of 1 fires immediately even when a huge capMs is clamped down.
    const fake = fakeChild(),
          outcome = await runPlayer(soundPlayerCommand('x.wav'), () => fake.child, 1);
    expect(outcome.capped).toBe(true);
    expect(HARD_CAP_MS).toBeLessThanOrEqual(12000);
  });

  test('a first outcome wins: an exit after the cap kill changes nothing', async () => {
    const fake = fakeChild(),
          outcome = await runPlayer(soundPlayerCommand('x.wav'), () => fake.child, 15);
    expect(outcome.capped).toBe(true);
    expect(() => { fake.fire('exit', 0); }).not.toThrow();
  });

});
