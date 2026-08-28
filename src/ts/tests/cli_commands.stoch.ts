import * as fc                    from 'fast-check';
import { parseCommand, run }      from '../cli_commands.js';
import type { CliStreams }        from '../cli_commands.js';

/** The tokens that mean something; everything else must fall through to `unknown`. */
const RESERVED = new Set(['mcp', 'help', '--help', '-h', 'hook', 'render', 'messages']);

/** The subcommands whose later arguments are grammar rather than noise. */
const TAKES_ARGUMENTS = new Set(['hook', 'render', 'messages']);

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
