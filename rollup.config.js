
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs    from '@rollup/plugin-commonjs';
import dts         from 'rollup-plugin-dts';



// The raster PNG encoder (src/ts/raster/encoder.ts, issue #7) imports node:zlib
// for deflateSync and crc32. The ES and CJS bundles run under Node, where the
// builtin resolves at load; marking it external keeps the import as written and
// silences the "unresolved dependency" warning. The IIFE bundle is loaded by the
// docs site in a browser, where a bare external would be a ReferenceError at
// script load — so it swaps node:zlib for a stub whose functions throw only if
// actually called. Every other raster export (font, surface, panels) is pure JS
// and works in the browser unchanged.
const nodeBuiltinExternal = (id) => id.startsWith('node:');

const zlibBrowserStub = {
  name: 'zlib-browser-stub',
  resolveId(id) { return id === 'node:zlib' ? '\0zlib-browser-stub' : null; },
  load(id) {
    if (id !== '\0zlib-browser-stub') return null;
    return [
      'const unavailable = (name) => () => {',
      '  throw new Error(`node:zlib is unavailable in the browser bundle; ${name} requires Node`);',
      '};',
      'export const deflateSync = unavailable("deflateSync");',
      'export const crc32       = unavailable("crc32");',
    ].join('\n');
  },
};



const es_config = {

  input: 'build/ts/index.js',

  external: nodeBuiltinExternal,

  output: {
    file      : 'build/rollup/index.mjs',
    format    : 'es',
    name      : 'selfExpression',
    sourcemap : true
  },

  plugins : [

    nodeResolve({
      mainFields     : ['module', 'main'],
      browser        : true,
      extensions     : [ '.ts' ],
      preferBuiltins : false
    }),

    commonjs()

  ]

};





const cjs_config = {

  input: 'build/ts/index.js',

  external: nodeBuiltinExternal,

  output: {
    file      : 'build/rollup/index.cjs',
    format    : 'commonjs',
    name      : 'selfExpression',
    sourcemap : true
  },

  plugins : [

    nodeResolve({
      mainFields     : ['module', 'main'],
      browser        : true,
      extensions     : [ '.ts' ],
      preferBuiltins : false
    }),

    commonjs()

  ]

};





const iife_config = {

  input: 'build/ts/index.js',

  output: {
    file      : 'build/rollup/index.iife.js',
    format    : 'iife',
    name      : 'selfExpression',
    sourcemap : true
  },

  plugins : [

    zlibBrowserStub,

    nodeResolve({
      mainFields     : ['module', 'main'],
      browser        : true,
      extensions     : [ '.ts' ],
      preferBuiltins : false
    }),

    commonjs()

  ]

};





// The bin bundles only this project's own code. Every bare specifier — node:
// builtins, the MCP SDK, zod — stays external and resolves from node_modules at
// runtime, which is how an npm-installed executable is normally shaped.
//
// Bundling them is not merely wasteful but broken: the SDK's dependency tree pulls in
// express, hono, ajv and jose, and ajv imports JSON, which Rollup cannot parse without
// an extra plugin. node:sqlite must be external regardless, being a builtin.
const cli_config = {

  input: 'build/ts/cli.js',

  external: (id) => !id.startsWith('.') && !id.startsWith('/'),

  output: {
    file      : 'build/rollup/cli.cjs',
    format    : 'commonjs',
    banner    : '#!/usr/bin/env node',
    name      : 'selfExpressionCli',
    sourcemap : true
  }

};




// Emits the CommonJS .d.cts declaration that used to live in
// rollup.ctsphase.config.js. Input is the freshly-emitted .d.ts from
// `tsc --build` (build/ts/index.d.ts), so this config does not need
// to wait for the build chain's `dts` step to copy declarations into
// dist/ — it can run in the same Rollup invocation as the bundlers.
const cjs_cts = {

  input: 'build/ts/index.d.ts',

  output: {
    file   : './dist/index.d.cts',
    format : 'es'
  },

  plugins : [ dts() ]

};



export default [ es_config, cjs_config, iife_config, cjs_cts, cli_config ];
