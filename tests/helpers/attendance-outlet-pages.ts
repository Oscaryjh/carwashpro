import { build } from "esbuild";
import { createRequire } from "node:module";

export async function attendanceOutletPages() {
  const stubs: Record<string, string> = {
    "server-only": "export {};",
    "@/lib/prisma": "export const prisma=globalThis.attendanceOutletDb;",
    "@/lib/auth/business-user": "export async function requireBusinessUser(){return globalThis.attendanceOutletActor}",
    "@/lib/branches": "export async function getOperationalBranches(){return globalThis.attendanceOutletBranches}",
    "next/navigation": "export function notFound(){throw Error('NOT_FOUND')} export function redirect(url){throw Error('REDIRECT:'+url)}",
  };
  const result = await build({ stdin: { contents: 'export {default as List} from "./src/app/(business)/team/attendance/page";export {GET as Export} from "./src/app/(business)/team/attendance/export/route";export {default as Settings} from "./src/app/(business)/team/attendance-settings/page";export {default as P2} from "./src/app/(business)/team/attendance/p2/page";', resolveDir: process.cwd() },
    bundle: true, write: false, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    plugins: [{ name: "attendance-request", setup(b) {
      b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "request" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "request" }, a => ({ contents: stubs[a.path], loader: "ts", resolveDir: process.cwd() }));
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get:(_,k)=>k})', loader: "js" }));
    } }],
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports as {
    List: (props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => Promise<unknown>;
    Export: (request: Request) => Promise<Response>;
    Settings: () => Promise<import("react").ReactNode>;
    P2: (props: { searchParams: Promise<Record<string, string>> }) => Promise<import("react").ReactNode>;
  };
}
