import * as fc                    from 'fast-check';
import { parseCommand, run }      from '../cli_commands.js';
import type { CliStreams }        from '../cli_commands.js';

/**
 * The tokens that mean something; everything else must fall through to `unknown`.
 *
 * Mirrors the literal comparisons in {@link parseCommand} one for one — `mcp`, `hook`,
 * `render`, `messages`, `notes`, and the three spellings of help. Kept as a checklist
 * against that function's source rather than derived from it, because `parseCommand`
 * has no exported command table to derive from; a command added there without a
 * matching addition here is exactly the drift this list exists to catch.
 */
const RESERVED = new Set(['mcp', 'help', '--help', '-h', 'hook', 'render', 'messages', 'notes']);

/** The subcommands whose later arguments are grammar rather than noise. */
const TAKES_ARGUMENTS = new Set(['hook', 'render', 'messages', 'notes']);

describe('stochastic cli parsing', () => {

  test('stoch: any non-reserved first token round-trips as unknown', () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !RESERVED.has(s)), (token: string) => {
        expect(parseCommand([token])).toEqual({ kind: 'unknown', token });
      })
    );
  });

  test('stoch: trailing arguments never change which command is chosen, outside flag grammars', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !TAKES_ARGUMENTS.has(s)),
        fc.array(fc.string()),
        (first: string, rest: string[]) => {
          expect(parseCommand([first, ...rest])).toEqual(parseCommand([first]));
        })
    );
  });

  test('stoch: run always returns a valid exit code and never throws', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (argv: string[]) => {
        const sink: CliStreams = { out: () => undefined, err: () => undefined },
              code             = run(argv, sink);
        expect(Number.isInteger(code)).toBe(true);
        expect(code).toBeGreaterThanOrEqual(0);
        expect(code).toBeLessThanOrEqual(125);
      })
    );
  });

});
