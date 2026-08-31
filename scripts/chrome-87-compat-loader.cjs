/* eslint-disable @typescript-eslint/no-require-imports */
const { transformSync } = require("esbuild");

module.exports = function chrome87CompatibilityLoader(source, inputSourceMap) {
  const transformed = transformSync(source, {
    loader: "js",
    minify: false,
    sourcefile: this.resourcePath,
    sourcemap: this.sourceMap ? "external" : false,
    target: "chrome87",
  });

  const sourceMap = transformed.map
    ? JSON.parse(transformed.map)
    : inputSourceMap;

  this.callback(null, transformed.code, sourceMap);
};
