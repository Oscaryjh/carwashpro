import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {createRequire} from "node:module";
import {renderToStaticMarkup} from "react-dom/server";
import {getBusinessGroupNavItems} from "../../src/lib/business-groups/navigation";

test("Group navigation labels closing as historical rather than daily work",()=>{
 const item=getBusinessGroupNavItems("group").find(row=>row.href.includes("/closing"));
 assert.equal(item?.label,"Historical closings");
});

async function renderGroupPage(kind:"closing"|"overview", success = false) {
 const directory=await mkdtemp(join(process.cwd(),"node_modules/.cache/group-retirement-"));
 const metrics={grossSalesCents:12300,netSalesCents:12000,paymentsCollectedCents:11000,refundsCents:300,transactionCount:2,averageTransactionValueCents:6000};
 const state={confidenceReads:0,success,report:{range:"today",authorizedBusinessCount:0,businesses:[],current:{...metrics,comparisons:Object.fromEntries(Object.keys(metrics).map(key=>[key,{kind:"NO_CHANGE"}]))},previous:metrics}};(globalThis as any).groupRetirement=state;
 const io=`
 export const requireUser=async()=>({userId:"user",role:"BUSINESS_OWNER",activeBusinessId:"business",contextVersion:1});
 export const getAvailableGroupReportingContexts=async()=>[{groupId:"group",groupName:"Group",canViewAllStores:true,role:"GROUP_OWNER",businesses:[]}];
 export const getAvailableBusinessContexts=async()=>({businesses:[]});
 export const createBusinessContextToken=async()=>"test-token";
 export const isBusinessModuleEnabled=async()=>true;
 export class AllStoresKpiRangeError extends Error {};
 export class GroupClosingInputError extends Error {};
 export const getAllStoresKpiReport=async()=>{if(globalThis.groupRetirement.success)return globalThis.groupRetirement.report;throw new AllStoresKpiRangeError("Invalid range")};
 export const getGroupDataConfidenceReport=async()=>{globalThis.groupRetirement.confidenceReads++;return null};
 export const getAuthorizedGroupPerformanceSpending=async()=>null;
 export const getGroupClosingReport=async()=>({groupId:"group",groupName:"Group",filters:{range:"today",page:1,auditPage:1},audit:{checkedAt:new Date(),missingCount:1,requiredCount:1,completedCount:0,completionPercent:0,notDueCount:0,notApplicableCount:0,unexpectedSnapshotCount:0,rows:[],page:1,totalPages:1,totalRows:1},summary:{snapshotCount:0,storeCount:0,branchCount:0,invalidReportCount:0,grossSalesCents:0,netSalesCents:0,collectedCents:0,outstandingCents:0,refundsCents:0,expectedCashCents:0,actualCashCents:0,cashDifferenceCents:0,balancedCount:0,overCount:0,shortCount:0},rows:[],totalRows:0,totalPages:1});
 `;
 try {
  await build({entryPoints:[`src/app/(group)/groups/[groupId]/${kind}/page.tsx`],outfile:join(directory,"page.cjs"),bundle:true,packages:"external",platform:"node",format:"cjs",jsx:"automatic",plugins:[{name:"group-read-boundaries",setup(b){
   b.onResolve({filter:/^next\/(link|navigation)$|^@\/components\//},a=>({path:a.path,namespace:"presentation-host"}));
   b.onLoad({filter:/.*/,namespace:"presentation-host"},a=>({resolveDir:process.cwd(),contents:a.path.endsWith("navigation")?'export function notFound(){throw Error("NOT_FOUND")} export function redirect(){throw Error("REDIRECT")}':`import {createElement} from "react";const C=({children,title,description,action})=>createElement("div",null,title,description,action,children);export default C;export {C as AppShellFrame,C as BusinessContextDrilldownButton,C as BusinessContextSwitcher,C as GroupLogoUpload,C as GroupPageHero,C as WalletFinancialSummary,C as GroupLongTermTrendFallback,C as GroupLongTermTrendSection};`}));
   b.onResolve({filter:/^@\/lib\/(auth\/(session|business-context-token)|modules\/entitlements|business-performance\/read-model|business-groups\/(all-stores-access|business-context|all-stores-kpi|group-data-confidence|group-closing-report))$/},a=>({path:a.path,namespace:"read-io"}));
   b.onLoad({filter:/.*/,namespace:"read-io"},()=>({contents:io}));
  }}]});
  const page=createRequire(import.meta.url)(join(directory,"page.cjs")).default;
  return {html:renderToStaticMarkup(await page({params:Promise.resolve({groupId:"group"}),searchParams:Promise.resolve({})})),reads:state.confidenceReads};
 }finally{delete (globalThis as any).groupRetirement;await rm(directory,{recursive:true,force:true})}
}
test("Group historical page does not impose missing/completed closing requirements",async()=>{
 const {html}=await renderGroupPage("closing");
 assert.doesNotMatch(html,/required closing|Required closing checklist|Closing audit|Completion rate|Missing closings/);
 assert.match(html,/Historical closing records/);
});
test("Overview stops querying Closing confidence even when core report is unavailable",async()=>{
 const {html,reads}=await renderGroupPage("overview");assert.equal(reads,0);assert.match(html,/Invalid range/);assert.doesNotMatch(html,/Closing coverage|Data confidence|Review Daily Closing/);
});
test("successful Overview keeps core KPI amounts and store ranking without Closing compliance",async()=>{
 const {html,reads}=await renderGroupPage("overview",true);
 assert.equal(reads,0);
 for(const copy of ["Group performance","Store performance ranking","Gross sales","Net sales","Gross collections","123.00","120.00","110.00"])assert.ok(html.includes(copy),copy);
 assert.doesNotMatch(html,/Closing coverage|Data confidence|Review Daily Closing|Missing closings/);
});
