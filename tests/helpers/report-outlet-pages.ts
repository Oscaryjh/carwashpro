import { build } from "esbuild";
import { createRequire } from "node:module";

export async function reportOutletPages() {
  const stubs: Record<string,string> = {
    "server-only": "export {};",
    "@/lib/prisma": "export const prisma=globalThis.reportPageDb;",
    "@/lib/tenant": "export const getBusinessContext=async()=>globalThis.reportPageContext;export const requireBusinessContext=getBusinessContext;",
    "@/lib/auth/business-user": "export const requireBusinessUserWithAnyCapability=async()=>globalThis.reportPageContext;export const requireBusinessUser=requireBusinessUserWithAnyCapability;",
    "@/lib/performance/dashboard": "export const readPerformanceDashboard=input=>{throw Object.assign(Error('PERFORMANCE_READER'),{input})};",
    "next/cache": "export const revalidatePath=()=>{};",
    "@/lib/business-performance/read-model": "export const getBusinessPerformanceReadModel=input=>{if(globalThis.reportPageModel)return globalThis.reportPageModel;throw Object.assign(Error('READER'),{input})};",
    "@/lib/reports/daily-sales": "export {resolveReportBranchScope} from './src/lib/reports/daily-sales';export const getDailySalesReport=input=>{throw Object.assign(Error('READER'),{input})};",
    "@/lib/modules/entitlements": "export const isBusinessModuleEnabled=async()=>false;export const loadBusinessModuleContext=async()=>({enabledModules:new Set()});export const requireBusinessModules=async()=>({});export class ModuleNotEnabledError extends Error{};",
    "next/navigation": "export const useRouter=()=>({});export const notFound=()=>{throw Error('NOT_FOUND')};export const redirect=url=>{throw Error('REDIRECT:'+url)};",
  };
  const result = await build({stdin:{contents:'export {default as Dashboard} from "./src/app/(business)/dashboard/page";export {default as Reports} from "./src/app/(business)/reports/page";export {default as Performance} from "./src/app/(business)/team/performance/page";',resolveDir:process.cwd()},bundle:true,write:false,platform:"node",format:"cjs",packages:"external",jsx:"automatic",logLevel:"silent",plugins:[{name:"report-request",setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"request"}:undefined);
    b.onLoad({filter:/.*/,namespace:"request"},a=>({contents:stubs[a.path],loader:"ts",resolveDir:process.cwd()}));
    b.onLoad({filter:/\.css$/},()=>({contents:"export default new Proxy({}, {get:(_,k)=>k})",loader:"js"}));
  }}]});
  const compiled={exports:{}};
  new Function("require","module","exports",result.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
  return compiled.exports as Record<"Dashboard"|"Reports"|"Performance",(p:{searchParams:Promise<Record<string,string>>})=>Promise<unknown>>;
}
