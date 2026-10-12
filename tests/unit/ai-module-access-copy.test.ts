import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleKeys } from "../../src/lib/modules/registry";
import type { ModuleAccessManager } from "../../src/components/module-access-manager";
import type { ModuleAccessRow } from "../../src/components/module-access-state";
const require = createRequire(import.meta.url);

test("enabled AI module copy describes access, not usage or provider readiness", async () => {
  const bundle = await build({ entryPoints: ["src/components/module-access-manager.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "css", setup(b) { b.onLoad({filter:/\.css$/},()=>({contents:"export default {};",loader:"js"})); } }] });
  const compiled = { exports: {} as { ModuleAccessManager: typeof ModuleAccessManager } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  const html = renderToStaticMarkup(createElement(compiled.exports.ModuleAccessManager, {
    businessId: "synthetic", evaluatedAt: "2026-10-12T00:00:00Z", embedded: true, result: {}, action: async () => {},
    initialRows: moduleKeys.map<ModuleAccessRow>(key => ({key,status:key === "AI" || key === "CORE" ? "ENABLED" : "DISABLED",from:"2026-10-02T00:00:00Z",until:null,plan:"",revision:1,source:"MANUAL"})),
  }));
  assert.match(html, /Module access enabled/);
  assert.match(html, /AI usage allowance and provider setup are separate/);
  assert.doesNotMatch(html, /AI ready|Ready to use|Ask Tetamu enabled/);
});
