import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

test("Workspace separates legacy branch management from primary navigation for zero, one and many branches", async () => {
  const cache = join(process.cwd(), "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "workspace-outlet-ui-"));
  const key = "__workspaceOutletUiQuery";
  (globalThis as any)[key] = "";
  try {
    const outfile = join(directory, "workspace.cjs");
    await build({ entryPoints: ["src/components/admin-business-workspace.tsx"], outfile,
      bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
      loader: { ".css": "empty" }, logLevel: "silent",
      plugins: [{ name: "request-context", setup(builder) {
        builder.onResolve({ filter: /^(next\/navigation|\.\/admin-reset-password-form|\.\/admin-update-login-email-form)$/ }, args => ({ path: args.path, namespace: "request-context" }));
        builder.onLoad({ filter: /.*/, namespace: "request-context" }, args => ({ contents:
          args.path === "next/navigation"
            ? `export const usePathname=()=>'/admin/businesses/store-a'; export const useSearchParams=()=>new URLSearchParams(globalThis[${JSON.stringify(key)}]);`
            : "export const AdminResetPasswordForm=()=>null; export const AdminUpdateLoginEmailForm=()=>null;",
        }));
      } }],
    });
    const { AdminBusinessWorkspace } = createRequire(import.meta.url)(outfile);
    const branches = [
      { id: "b1", name: "Lintas", phone: null, address: null, status: "ACTIVE" },
      { id: "b2", name: "Damai", phone: null, address: null, status: "INACTIVE" },
    ];
    const render = (count: number) => renderToStaticMarkup(createElement(AdminBusinessWorkspace, {
      business: { id: "store-a", name: "Store A", slug: "store-a", industry: "Salon", companyNo: null, status: "active" },
      branches: branches.slice(0, count), users: [], enabledModules: 15,
      modules: createElement("p", null, "Modules content"), profile: createElement("p", null, "Profile content"),
      branchStatusAction: async () => { throw new Error("Rendering must not mutate branches"); }, result: {},
    }));
    for (const count of [0, 1, 2]) {
      const html = render(count);
      const metrics = html.match(/<section[^>]*aria-label="Business summary"[^>]*>(.*?)<\/section>/s)![1];
      assert.doesNotMatch(metrics, /Branches/);
      assert.match(metrics, /Users/); assert.match(metrics, /Enabled modules/);
      const nav = html.match(/<nav[^>]*aria-label="Business workspace sections"[^>]*>(.*?)<\/nav>/s)![1];
      assert.doesNotMatch(nav, /section=branches/);
      for (const section of ["overview", "modules", "profile", "users"]) assert.match(nav, new RegExp(`section=${section}`));
      assert.match(html, /<details(?![^>]*\bopen)[^>]*>\s*<summary>Advanced \/ Legacy<\/summary>/);
      assert.match(html, /href="\/admin\/businesses\/store-a\?section=branches"[^>]*>Manage branches<\/a>/);
      assert.match(html, /each physical outlet as a separate Business/);
    }
    (globalThis as any)[key] = "section=branches";
    const legacy = render(2);
    assert.match(legacy, /<section(?![^>]*\bhidden)[^>]*aria-label="Branches"/);
    assert.match(legacy, /<section[^>]*tabindex="-1"[^>]*aria-label="Branches"/);
    assert.match(legacy, /Lintas/); assert.match(legacy, /Damai/);
    assert.match(legacy, />Deactivate<\/button>/); assert.match(legacy, />Activate<\/button>/);
    assert.match(legacy, /href="\/admin\/businesses\/store-a\/branches\/new"/);
    assert.match(legacy, /View details/);
  } finally {
    delete (globalThis as any)[key];
    await rm(directory, { recursive: true, force: true });
  }
});
