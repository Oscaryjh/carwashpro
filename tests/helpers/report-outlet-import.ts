import { build } from "esbuild";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

export async function reportOutletModule() {
  if (!existsSync("src/lib/report-outlet-context.ts")) return {} as typeof import("../../src/lib/report-outlet-context");
  const result = await build({ entryPoints: ["src/lib/report-outlet-context.ts"], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", plugins: [{ name: "server-marker", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "marker" }));
      b.onLoad({ filter: /.*/, namespace: "marker" }, () => ({ contents: "export {}", loader: "js" }));
    } }] });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports as typeof import("../../src/lib/report-outlet-context");
}
