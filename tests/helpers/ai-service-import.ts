import { build } from "esbuild";
import { createRequire } from "node:module";

// Next's server-only marker is a build boundary, not an npm runtime dependency.
// Keep all real authorization/readers and the actual Prisma client in tests.
export async function aiServiceModule() {
  const result = await build({ entryPoints: ["src/lib/ai/service.ts"], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", plugins: [{ name: "server-marker", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "marker" }));
      b.onLoad({ filter: /.*/, namespace: "marker" }, () => ({ contents: "export {}", loader: "js" }));
    } }] });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports as typeof import("../../src/lib/ai/service");
}
