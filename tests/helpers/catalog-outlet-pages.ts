import { build } from "esbuild";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import type { PrismaClient } from "@prisma/client";

/** Real tenant/session/access and actions; only Next request/cache are adapted. */
export async function catalogOutletPages(database: PrismaClient) {
  Object.assign(globalThis, { catalogOutletPageDb: database });
  const stubs: Record<string, string> = {
    "server-only": "export {};",
    "@/lib/prisma": "export const prisma=globalThis.catalogOutletPageDb;",
    "next/cache": "export const revalidatePath=()=>{};",
    "next/navigation": "export const useRouter=()=>({back(){}});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=url=>{throw Error('REDIRECT:'+url)};",
    "next/headers": "export const headers=async()=>new Headers({'host':'localhost:3116','origin':'http://localhost:3116'});export const cookies=async()=>({get(){return globalThis.catalogOutletPageCookie?{value:globalThis.catalogOutletPageCookie}:undefined}});",
  };
  const result = await build({ stdin: { contents: 'export {default as Services} from "./src/app/(business)/services/page";export {default as ServiceDetail} from "./src/app/(business)/services/[serviceId]/page";export {default as Packages} from "./src/app/(business)/packages/page";export {default as PackageDetail} from "./src/app/(business)/packages/[packageId]/page";export {default as Hub} from "./src/app/(business)/package-hub/page";', resolveDir: process.cwd() }, bundle:true,write:false,platform:"node",format:"cjs",packages:"external",jsx:"automatic",logLevel:"silent",plugins:[{name:"catalog-page-request",setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"request"}:undefined);
    b.onLoad({filter:/.*/,namespace:"request"},a=>({contents:stubs[a.path],loader:"ts",resolveDir:process.cwd()}));
    b.onLoad({filter:/\.css$/},()=>({contents:"export default new Proxy({}, {get:(_,k)=>k})",loader:"js"}));
  }}] });
  type Page = (props:{searchParams:Promise<Record<string,string>>})=>Promise<ReactNode>;
  const compiled={exports:{} as {Services:Page;Packages:Page;Hub:Page;ServiceDetail:(p:{params:Promise<{serviceId:string}>})=>Promise<ReactNode>;PackageDetail:(p:{params:Promise<{packageId:string}>})=>Promise<ReactNode>}};
  new Function("require","module",result.outputFiles[0].text)(createRequire(import.meta.url),compiled);
  return compiled.exports;
}
