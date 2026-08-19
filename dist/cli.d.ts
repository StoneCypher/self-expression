/**
 * Executable entry point for the `self-expression` bin.
 *
 * Deliberately thin: it resolves the version, wires real process streams, stdin, and
 * the real exit code to the dispatcher in `cli_commands.ts`, and does nothing else.
 * All behaviour worth testing lives there and in the store modules, so importing this
 * file is the only thing that starts a process — which is exactly what Rollup needs
 * from a bundle entry, and exactly what a test must avoid.
 *
 * @see ./cli_commands.js
 * @see ./mcp/server.js
 * @see ./mcp/hooks.js
 */
export {};
//# sourceMappingURL=cli.d.ts.map