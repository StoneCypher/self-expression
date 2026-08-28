/**
 * Executable entry point for the `self-expression-audio` bin — the claudio facility.
 *
 * Deliberately thin, exactly like `cli.ts`: resolve the version and the vendored
 * asset directory from the bundle's own location, dispatch the one real subcommand,
 * and nothing else. The audio facility ships in its own bundle so the main
 * self-expression server never loads a line of player code.
 *
 * @see ./claudio/server.js
 * @see ./cli.js
 */
export {};
//# sourceMappingURL=claudio_cli.d.ts.map