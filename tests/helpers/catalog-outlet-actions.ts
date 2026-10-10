import { build } from "esbuild";
import { createRequire } from "node:module";

/** Substitute request/delivery boundaries only; exercise the real catalog actions. */
export async function catalogOutletActions(database: unknown, context: unknown) {
  Object.assign(globalThis, { catalogOutletTestDb: database, catalogOutletTestContext: context });
  const stubs: Record<string, string> = {
    "server-only": "export {};",
    "@/lib/prisma": "export const prisma=globalThis.catalogOutletTestDb;",
    "@/lib/auth/business-user": "export const requireBusinessUserForModule=async()=>globalThis.catalogOutletTestContext;",
    "next/cache": "export const revalidatePath=()=>{};",
    "next/navigation": "export const redirect=url=>{throw Error('REDIRECT:'+url)};",
  };
  const result = await build({ stdin: { contents: 'export {resolveCatalogOutletContext,guardCatalogOutletSubmission} from "./src/lib/catalog-outlet-context";export {updateServiceAction,createServiceAction} from "./src/app/(business)/services/actions";export {updatePackageAction,createPackageAction} from "./src/app/(business)/packages/actions";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent", plugins: [{ name: "catalog-request", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "request" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "request" }, a => ({ contents: stubs[a.path], loader: "ts" }));
  } }] });
  const compiled = { exports: {} as Record<"updateServiceAction" | "createServiceAction" | "updatePackageAction" | "createPackageAction", (data: FormData) => Promise<void>> & typeof import("../../src/lib/catalog-outlet-context") };
  new Function("require", "module", result.outputFiles[0].text)(createRequire(import.meta.url), compiled);
  return compiled.exports;
}
