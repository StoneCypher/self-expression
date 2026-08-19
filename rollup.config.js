
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs    from '@rollup/plugin-commonjs';
import dts         from 'rollup-plugin-dts';





const es_config = {

  input: 'build/ts/index.js',

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
