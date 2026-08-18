
import dts from 'rollup-plugin-dts';





const cjs_cts = {

  input: "./dist/index.d.ts",

  output: {
    file: "./dist/index.d.cts", // Generate .cts for CommonJS
    format: "es",
  },

  plugins: [ dts() ]

};





export default [ cjs_cts ];
