
import nodeResolve    from '@rollup/plugin-node-resolve';
import commonjs       from '@rollup/plugin-commonjs';
import { visualizer } from "rollup-plugin-visualizer";





const es_config = {

  input: 'build/ts/index.js',

  output: {
    file      : 'build/rollup/index.mjs',
    format    : 'es',
    name      : 'react_ts_with_claude_gh_template',
    sourcemap : true
  },

  plugins : [

    nodeResolve({
      mainFields     : ['module', 'main'],
      browser        : true,
      extensions     : [ '.ts' ],
      preferBuiltins : false
    }),

    commonjs(),

    visualizer({ filename: "build/rollup/visualizations/bundle_sunburst.html",   template: "sunburst" }),
    visualizer({ filename: "build/rollup/visualizations/bundle_treemap.html",    template: "treemap" }),
    visualizer({ filename: "build/rollup/visualizations/bundle_network.html",    template: "network" }),
    visualizer({ filename: "build/rollup/visualizations/bundle_flamegraph.html", template: "flamegraph" })

  ]

};





const cjs_config = {

  input: 'build/ts/index.js',

  output: {
    file      : 'build/rollup/index.cjs',
    format    : 'commonjs',
    name      : 'react_ts_with_claude_gh_template',
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
    name      : 'react_ts_with_claude_gh_template',
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





// const cli_config = {

//   input: 'build/ts/cli.js',

//   output: {
//     file   : 'build/rollup/cli.cjs',
//     format : 'commonjs',
//     banner : '#!/usr/bin/env node',
//     name   : 'react_ts_with_claude_gh_template-cli'
//   },

//   plugins : [

//     nodeResolve({
//       mainFields     : ['module', 'main'],
//       browser        : false,
//       extensions     : [ '.ts', '.js' ],
//       preferBuiltins : true
//     }),

//     commonjs(),

//     visualizer()

//   ]

// };




export default [ es_config, cjs_config, iife_config ];  // , cli_config ];
