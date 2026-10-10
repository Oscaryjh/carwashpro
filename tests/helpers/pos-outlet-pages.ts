import { build } from "esbuild";
import { createRequire } from "node:module";
import { isValidElement, type ReactNode } from "react";
import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

/** Only request framework/delivery boundaries are substituted; auth, adapter,
 * actions, database transactions and financial/inventory services are real. */
export async function posOutletPages(database: PrismaClient) {
  (globalThis as typeof globalThis & { posOutletTestDb?: PrismaClient }).posOutletTestDb = database;
  const stubs: Record<string, string> = {
    "server-only": "export {};",
    "@/lib/prisma": "export const prisma=globalThis.posOutletTestDb;",
    "next/cache": "export const revalidatePath=()=>{};",
    "next/navigation": "export const useRouter=()=>({back(){}});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=url=>{throw Error('REDIRECT:'+url)};export function unstable_rethrow(error){if(error?.message?.startsWith('REDIRECT:')||error?.message==='NOT_FOUND')throw error;}",
    "next/headers": "export const headers=async()=>new Headers({'host':'localhost:3115','origin':'http://localhost:3115'});export const cookies=async()=>({get(){return globalThis.walletCheckoutCookie?{value:globalThis.walletCheckoutCookie}:undefined}});",
  };
  const result = await build({ stdin: { contents: 'export {default as Cashier} from "./src/app/(business)/cashier/page";export {default as NewAppointment} from "./src/app/(business)/appointments/new/page";export {default as Appointments, mapCalendarAppointment} from "./src/app/(business)/appointments/page";export {default as Detail} from "./src/app/(business)/appointments/[appointmentId]/page";', resolveDir: process.cwd() }, write: false, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", logLevel: "silent", plugins: [{ name: "local-request-only", setup(b) {
    b.onLoad({ filter: /[\\/]appointments[\\/]page\.tsx$/ }, async a => ({ contents: await readFile(a.path, "utf8") + '\nexport {toCalendarItem as mapCalendarAppointment};', loader: "tsx", resolveDir: a.path.replace(/[\\/][^\\/]+$/, "") }));
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "request" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "request" }, a => ({ contents: stubs[a.path], loader: "ts", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,k)=>k})", loader: "js" }));
    b.onResolve({ filter: /whatsapp\/invoice-notifications$/ }, () => ({ path: "no-delivery", namespace: "delivery" }));
    b.onLoad({ filter: /.*/, namespace: "delivery" }, () => ({ contents: "export async function sendInvoiceIfConnected(){}" }));
  } }] });
  type Page = (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;
  const compiled = { exports: {} as { mapCalendarAppointment: (appointment: Record<string, unknown>, ...maps: Map<string, never>[]) => { serviceIds: string[] }; Cashier: Page; NewAppointment: Page; Appointments: Page; Detail: (props: { params: Promise<{ appointmentId: string }>; searchParams: Promise<Record<string, string>> }) => Promise<ReactNode> } };
  new Function("require", "module", result.outputFiles[0].text)(createRequire(import.meta.url), compiled);
  return compiled.exports;
}

export function findPosElement(node: ReactNode, predicate: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> {
  if (Array.isArray(node)) {
    for (const child of node) { try { return findPosElement(child, predicate); } catch { /* next sibling */ } }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    const props = node.props as Record<string, unknown>;
    if (predicate(node.type, props)) return props;
    return findPosElement(node.props.children, predicate);
  }
  throw new Error("Expected page element not found");
}
