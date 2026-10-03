import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("catalog modal hides the non-functional plus while retaining title, close and form content", async () => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/catalog-mark-"));
  try {
    await build({ entryPoints: ["src/components/catalog-form-modal.tsx"], outfile: join(dir, "ui.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", plugins: [{ name: "navigation", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "navigation" }));
      b.onLoad({ filter: /.*/, namespace: "navigation" }, () => ({ contents: "export function useRouter(){return {replace(){throw Error('Unexpected navigation')}}}" }));
    } }] });
    const { CatalogFormModal } = createRequire(import.meta.url)(join(dir, "ui.cjs"));
    const html = renderToStaticMarkup(createElement(CatalogFormModal, { ariaLabel: "New service", closePath: "/services", eyebrow: "Catalog", title: "New service", children: createElement("form", null, "Service fields") }));
    assert.doesNotMatch(html, /product-create-modal-mark/);
    assert.match(html, /aria-label="Close New service"/);
    assert.match(html, /<h2>New service<\/h2>/);
    assert.match(html, /<form>Service fields<\/form>/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
