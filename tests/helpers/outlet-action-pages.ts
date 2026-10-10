import { build } from "esbuild";
import { createRequire } from "node:module";
import { isValidElement, type ReactNode } from "react";
import { prisma } from "../../src/lib/prisma";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";
import { loadBusinessModuleContext } from "../../src/lib/modules/entitlements";

export async function compileOutletActionPages(identity: { businessId: string; userId: string }) {
  const runtime = globalThis as typeof globalThis & { __outletPageContext?: () => Promise<unknown> };
  runtime.__outletPageContext = async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: identity.userId } });
    const access = await resolveBusinessAccess({ userId: user.id, requestedBusinessId: identity.businessId, capability: "VIEW_CATALOG" });
    return { businessId: identity.businessId, user: { ...user, userId: user.id }, access, moduleContext: await loadBusinessModuleContext(identity.businessId) };
  };
  const stubs: Record<string, string> = {
    "server-only": "export {};",
    "next/cache": "export const revalidatePath=()=>{};",
    "next/navigation": "export const useRouter=()=>({back(){}});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=url=>{throw Error('REDIRECT:'+url)};",
    "next/headers": "export const headers=async()=>new Headers({'host':'localhost:3114','origin':'http://localhost:3114'});export const cookies=async()=>({get(){return undefined}});",
    "@/lib/auth/business-user": "export const requireBusinessUser=async()=>globalThis.__outletPageContext();export const requireBusinessUserForModule=requireBusinessUser;",
  };
  const result = await build({ stdin: { contents: 'export {default as Products} from "./src/app/(business)/products/page";export {default as Detail} from "./src/app/(business)/products/[productId]/page";export {default as AddStock} from "./src/app/(business)/inventory/stock-in/page";export {default as Count} from "./src/app/(business)/inventory/adjustment/page";export {default as Remove} from "./src/app/(business)/inventory/stock-out/page";', resolveDir: process.cwd() }, write: false, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", logLevel: "silent", plugins: [{ name: "request-boundary-only", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "request" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "request" }, a => ({ contents: stubs[a.path], loader: "ts", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,k)=>k})", loader: "js" }));
  } }] });
  type Page = (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
  const compiled = { exports: {} as { Products: Page; AddStock: Page; Count: Page; Remove: Page; Detail: (props: {params: Promise<{productId:string}>}) => Promise<ReactNode> } };
  new Function("require", "module", result.outputFiles[0].text)(createRequire(import.meta.url), compiled);
  return compiled.exports;
}

export function findOutletFormAction(node: ReactNode, componentName: string): (data: FormData) => Promise<void> {
  if (Array.isArray(node)) {
    for (const child of node) { try { return findOutletFormAction(child, componentName); } catch { /* next sibling */ } }
  } else if (isValidElement<{ action?: (data: FormData) => Promise<void>; children?: ReactNode }>(node)) {
    if (typeof node.type === "function" && node.type.name === componentName && node.props.action) return node.props.action;
    return findOutletFormAction(node.props.children, componentName);
  }
  throw new Error(`No ${componentName} action`);
}
