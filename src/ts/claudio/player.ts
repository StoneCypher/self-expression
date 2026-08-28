/**
 * The player seam: command construction and child-process supervision.
 *
 * The pinned mechanism (and the whole lesson of the predecessor): spawn a short-lived
 * `powershell -NoProfile -NonInteractive` child that plays a vendored WAV
 * synchronously via `System.Media.SoundPlayer.PlaySync()` and exits. Zero native
 * dependencies, zero install-time compilation. Everything above this seam is
 * platform-neutral; an unsupported platform resolves to no player and the tools are
 * never registered.
 *
 * Command construction is pure and separately exported so tests can assert the exact
 * command line without any process existing; `runPlayer` takes the spawn function as
 * a parameter for the same reason. The hard duration cap (spec rule 5) is enforced
 * here with a kill timer — nothing the child does can keep sound alive past it.
 *
 * @see ./wav.js
 * @see ./tools.js
 */

/** The absolute longest any child may live, in milliseconds. Nothing loops. Ever. */
export const HARD_CAP_MS = 12000;

/** The longest WAV `strike`/`audition` will play, in milliseconds (spec: order of 10 s). */
export const MAX_WAV_MS = 10000;

/** The most characters `say` will speak — a sentence or two, not a monologue. */
export const MAX_SAY_CHARS = 400;

/** A command line ready to spawn: executable and argument vector. */
export interface PlayerCommand {
  readonly exe  : string;
  readonly args : readonly string[];
}

/** The subset of a child process the supervisor needs; `node:child_process` satisfies it. */
export interface ChildLike {
  on(event: 'exit',  listener: (code: number | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  kill(): boolean;
}

/** Spawn function shape, injectable so tests never start a real process. */
export type SpawnLike = (exe: string, args: readonly string[]) => ChildLike;

/** How a play attempt ended. */
export interface PlayOutcome {
  readonly ok     : boolean;
  /** True when the hard cap killed the child — always worth ledgering. */
  readonly capped : boolean;
  /** Failure description when `ok` is false. */
  readonly detail : string | null;
}

/**
 * Escape text for interpolation inside a PowerShell single-quoted string, where the
 * only metacharacter is the quote itself (doubled to escape). Control characters are
 * flattened to spaces so no argument can smuggle a line break into the command.
 *
 * @example
 *   escapePwshSingleQuoted("it's here")  // => "it''s here"
 */
export function escapePwshSingleQuoted(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/'/g, "''").replace(/[\u0000-\u001f\u007f]/g, ' ');
}

/**
 * The command that plays one WAV file synchronously and exits.
 *
 * `-NoProfile -NonInteractive` keeps startup lean and forbids prompts; `PlaySync`
 * needs no window, no STA pump, and is silent on success.
 *
 * @param wavPath - absolute path of the (already volume-scaled) WAV to play
 *
 * @example
 *   soundPlayerCommand('C:/tmp/claudio-x.wav').args[4]
 *   // => "(New-Object System.Media.SoundPlayer 'C:/tmp/claudio-x.wav').PlaySync()"
 */
export function soundPlayerCommand(wavPath: string): PlayerCommand {
  return {
    exe  : 'powershell',
    args : [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `(New-Object System.Media.SoundPlayer '${escapePwshSingleQuoted(wavPath)}').PlaySync()`,
    ],
  };
}

/**
 * The command that speaks one line through the local SAPI voice and exits — the
 * first TTS tier: offline, keyless, present on every Windows box.
 *
 * @param text   - what to say; escaped, control characters flattened
 * @param volume - SAPI volume 0–100, already clamped by the gate
 *
 * @example
 *   sapiSpeakCommand('the build is green', 40).exe  // => 'powershell'
 */
export function sapiSpeakCommand(text: string, volume: number): PlayerCommand {
  const script =
    'Add-Type -AssemblyName System.Speech; ' +
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
    `$s.Volume = ${String(Math.min(100, Math.max(0, Math.round(volume))))}; ` +
    `$s.Speak('${escapePwshSingleQuoted(text)}'); ` +
    '$s.Dispose()';
  return {
    exe  : 'powershell',
    args : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

/**
 * Whether `platform` has a player at all. Windows-first exactly as the design
 * surveys; the macOS (`afplay`) and Linux (`paplay`/`aplay`) implementations drop in
 * behind this same seam later without touching anything above it.
 *
 * @param platform - a `process.platform` value
 *
 * @example
 *   platformHasPlayer('win32')  // => true
 *   platformHasPlayer('linux')  // => false, for now — absence degrades to silence
 */
export function platformHasPlayer(platform: string): boolean {
  return platform === 'win32';
}

/**
 * Run one player command under the hard cap, resolving with how it ended.
 *
 * Resolves — never rejects — because every ending must reach the ledger. A nonzero
 * exit, a spawn error, and a cap kill are all outcomes, not exceptions. The kill
 * timer is unconditional: a child that outlives `capMs` is killed and the outcome
 * reports `capped`.
 *
 * @param command - what to spawn
 * @param spawnFn - the spawner; inject a fake in tests so no audio ever plays
 * @param capMs   - kill deadline in milliseconds; clamped to {@link HARD_CAP_MS}
 *
 * @example
 *   const outcome = await runPlayer(soundPlayerCommand(path), spawnDetached, 4000);
 *   outcome.ok  // => true when the child exited 0 before the cap
 */
export function runPlayer(
  command : PlayerCommand,
  spawnFn : SpawnLike,
  capMs   : number,
): Promise<PlayOutcome> {

  return new Promise<PlayOutcome>(resolve => {

    const deadline = Math.min(Math.max(1, capMs), HARD_CAP_MS);

    let child: ChildLike;
    try {
      child = spawnFn(command.exe, command.args);
    } catch (error) {
      resolve({ ok: false, capped: false,
                detail: `player failed to spawn: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    let done = false;
    const finish = (outcome: PlayOutcome): void => {
      if (done) { return; }
      done = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ ok: false, capped: true,
               detail: `killed at the ${String(deadline)} ms hard cap` });
    }, deadline);

    child.on('error', error => {
      finish({ ok: false, capped: false, detail: `player error: ${error.message}` });
    });

    child.on('exit', code => {
      finish(code === 0
        ? { ok: true,  capped: false, detail: null }
        : { ok: false, capped: false, detail: `player exited ${String(code)}` });
    });

  });

}
